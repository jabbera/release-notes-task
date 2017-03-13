import * as vsts from "vso-node-api";
import * as ra from "vso-node-api/ReleaseApi";
import * as tfvc from "vso-node-api/TfvcApi";
import * as wa from "vso-node-api/WorkItemTrackingApi";
import * as ri from "vso-node-api/interfaces/ReleaseInterfaces";
import * as tfcvi from "vso-node-api/interfaces/TfvcInterfaces";
import * as wi from "vso-node-api/interfaces/WorkItemTrackingInterfaces";
import * as tl from "vsts-task-lib/task";

export interface IReleaseSummaryFetcher {
    currentlyDeployedRelease(): Promise<ReleaseSummaryInformation>;
    releaseInProgress(): Promise<ReleaseSummaryInformation>;
    workItemsInRelease(): Promise<wi.WorkItem[]>;
    changesInRelease(): Promise<ReleaseCommit[]>;
};

export class ReleaseSummaryFetcher implements IReleaseSummaryFetcher {
    private teamProject: string;
    private releaseDefinitionId: number;
    private releaseId: number;
    private definitionEnvironmentId: number;

    private isInited: boolean = false;
    private currentlyDeployedReleaseField: ri.Release;
    private releaseInProgressField: ri.Release;
    private workItemsInReleaseField: wi.WorkItem[] = [];
    private changesInReleaseField: ReleaseCommit[] = [];

    constructor(teamProject: string, releaseDefinitionId: number, releaseId: number, definitionEnvironmentId: number) {
        this.teamProject = teamProject;
        this.releaseDefinitionId = releaseDefinitionId,
        this.releaseId = releaseId;
        this.definitionEnvironmentId = definitionEnvironmentId;
    }

    public async currentlyDeployedRelease(): Promise<ReleaseSummaryInformation> {
        await this.init();
        let summary: ReleaseSummaryInformation = this.getReleaseSummaryInformation(this.currentlyDeployedReleaseField);
        return summary;
    }

    public async releaseInProgress(): Promise<ReleaseSummaryInformation> {
        await this.init();
        let summary: ReleaseSummaryInformation = this.getReleaseSummaryInformation(this.releaseInProgressField);
        return summary;
    }

    public async workItemsInRelease(): Promise<wi.WorkItem[]> {
        await this.init();
        return this.workItemsInReleaseField;
    }

    public async changesInRelease(): Promise<ReleaseCommit[]> {
        await this.init();
        return this.changesInReleaseField;
    }

    private async init() {
        if (this.isInited) {
            return;
        }

        tl.debug("Getting releases");
        let token: string = tl.getEndpointAuthorizationParameter("SystemVssConnection", "AccessToken", false);
        let collectionUrl: string = tl.getEndpointUrl("SystemVssConnection", false);
        let authHandler = vsts.getPersonalAccessTokenHandler(token);
        let connect = new vsts.WebApi(collectionUrl, authHandler);
        let releaseApi: ra.IReleaseApi = connect.getReleaseApi();

        let releases: ri.Release[] = await releaseApi.getReleases(this.teamProject, this.releaseDefinitionId,
            this.definitionEnvironmentId, null, null, null, ri.EnvironmentStatus.Succeeded | ri.EnvironmentStatus.InProgress,
            null, null, null, 2, null, ri.ReleaseExpands.Environments | ri.ReleaseExpands.Artifacts);

        this.currentlyDeployedReleaseField = releases.find((x) => x.id === this.releaseId);
        this.releaseInProgressField = releases.find((x) => x.id !== this.releaseId);

        let workItemRefs: ri.ReleaseWorkItemRef[] = await releaseApi.getReleaseWorkItemsRefs(this.teamProject, this.releaseInProgressField.id, this.currentlyDeployedReleaseField.id);
        if (workItemRefs.length !== 0) {
            let workItemApi: wa.IWorkItemTrackingApi = connect.getWorkItemTrackingApi();
            this.workItemsInReleaseField = await workItemApi.getWorkItems(workItemRefs.map((x) => Number(x.id)), null, null, wi.WorkItemExpand.All);
        }

        // The documentation is backwards on the releaseid versus the basereleaseid
        let rawChanges: ri.Change[] = await releaseApi.getReleaseChanges(this.teamProject, this.currentlyDeployedReleaseField.id, this.releaseInProgressField.id, 1000);

        this.changesInReleaseField = await this.getTfvsChanges(rawChanges, connect);

        this.isInited = true;
    }

    private getReleaseSummaryInformation(release: ri.Release): ReleaseSummaryInformation {
        let definitionName: string = release.releaseDefinition.name;
        let primaryArtifact: ri.Artifact = release.artifacts.find((x) => x.isPrimary);
        let buildVersion: string = primaryArtifact.definitionReference.version.name;
        let buildWebLink: string = primaryArtifact.definitionReference.artifactSourceVersionUrl.id;
        let releasWebLink: string = release._links["web"].href;
        let environmentName: string = release.environments.find((x) => x.definitionEnvironmentId === this.definitionEnvironmentId).name;

        return {buildVersion: buildVersion, buildWebLink: buildWebLink, releaseWebLink: releasWebLink, definitionName: definitionName, environmentName: environmentName};
    }

    private async getTfvsChanges(changesInRelease: ri.Change[], connect: vsts.WebApi): Promise<ReleaseCommit[]> {
        let api: tfvc.ITfvcApi = connect.getTfvcApi();
        let idsToGet:number[] = changesInRelease.filter((x) => x.changeType === "TfsVersionControl").map((x) => Number(x.id.replace("C", "")));

        let tfvcChanges: tfcvi.TfvcChangesetRef[] = await api.getBatchedChangesets({ "changesetIds": idsToGet, "commentLength": 100, "includeLinks": true});
        if (tfvcChanges == null || tfvcChanges.length === 0) {
            return [];
        }

        let returnValue: ReleaseCommit[] = tfvcChanges.map((x) => {
            return {
                "author": x.author.displayName,
                "id": x.changesetId.toString(),
                "link": x._links["web"].href,
                "message": x.comment,
                "timestamp": x.createdDate,
            };
        });

        return returnValue;
    }
}