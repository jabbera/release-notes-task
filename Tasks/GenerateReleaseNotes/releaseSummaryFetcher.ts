import * as vsts from "vso-node-api";
import * as bi from "vso-node-api/BuildApi";
import * as git from "vso-node-api/GitApi";
import * as ra from "vso-node-api/ReleaseApi";
import * as tfvc from "vso-node-api/TfvcApi";
import * as wa from "vso-node-api/WorkItemTrackingApi";
import * as corei from "vso-node-api/interfaces/CoreInterfaces";
import * as giti from "vso-node-api/interfaces/GitInterfaces";
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
        let rconnect = new vsts.WebApi(collectionUrl, authHandler);
        let connect = new vsts.WebApi(collectionUrl.replace("vsrm.", ""), authHandler);
        let releaseApi: ra.IReleaseApi = rconnect.getReleaseApi();

        let releases: ri.Release[] = await releaseApi.getReleases(this.teamProject, this.releaseDefinitionId,
            this.definitionEnvironmentId, null, null, null, ri.EnvironmentStatus.Succeeded | ri.EnvironmentStatus.InProgress,
            null, null, null, 2, null, ri.ReleaseExpands.Environments | ri.ReleaseExpands.Artifacts);

        this.currentlyDeployedReleaseField = releases.find((x) => x.id === this.releaseId);
        this.releaseInProgressField = releases.find((x) => x.id !== this.releaseId);


        let workItemRefs: ri.ReleaseWorkItemRef[] = await releaseApi.getReleaseWorkItemsRefs(this.teamProject, this.releaseInProgressField.id, this.currentlyDeployedReleaseField.id);
        if (workItemRefs.length !== 0) {
                    let inIds: string = workItemRefs.map((x) => x.id).join(",");

                    let wiql: wi.Wiql = {
                        "query": `SELECT \
        [System.Links.LinkType], \
        [System.Id], \
        [System.WorkItemType], \
        [System.Title], \
        [System.State], \
        [System.AreaPath], \
        [System.IterationPath] \
FROM workitemLinks \
WHERE \
        [Source].[System.TeamProject] = @project \
        AND [Target].[System.Id] IN (${inIds}) \
        and [System.Links.LinkType] = "Child" \
ORDER BY [Source].[System.ChangedDate] DESC
mode(Recursive)`,
                    };


            let workItemApi: wa.IWorkItemTrackingApi = connect.getWorkItemTrackingApi();
            let qr: wi.WorkItemQueryResult = await workItemApi.queryByWiql(wiql, {"project": this.teamProject} as corei.TeamContext, false, 1000);
            this.workItemsInReleaseField = await workItemApi.getWorkItems(qr.workItemRelations.map((x) => Number(x.target.id)), null, null, wi.WorkItemExpand.All);
        }

        // The documentation is backwards on the releaseid versus the basereleaseid
        let rawChanges: ri.Change[] = await releaseApi.getReleaseChanges(this.teamProject, this.currentlyDeployedReleaseField.id, this.releaseInProgressField.id, 1000);

        this.changesInReleaseField = await this.getChanges(rawChanges, connect);

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

    private async getChanges(changesInRelease: ri.Change[], connect: vsts.WebApi): Promise<ReleaseCommit[]> {
        let tfvcChanges: Promise<ReleaseCommit[]> = this.getTfvcChanges(changesInRelease, connect);
        let gitChanges: Promise<ReleaseCommit[]> = this.getGitChanges(changesInRelease, connect);

        return (await tfvcChanges).concat(await gitChanges);
    }

    private async getGitChanges(changesInRelease: ri.Change[], connect: vsts.WebApi): Promise<ReleaseCommit[]> {
        let api: git.IGitApi = connect.getGitApi();
        let idsToGet: string[] = changesInRelease.filter((x) => x.changeType === "TfsGit").map((x) => x.id);

        if (idsToGet.length === 0) {
            return [];
        }

        let query: giti.GitQueryCommitsCriteria = {
            "$top": 1000,
            "itemPath": "",
                "itemVersion": {
                    "version": idsToGet[idsToGet.length - 1],
                    "versionType": giti.GitVersionType.Commit,
                    "versionOptions": giti.GitVersionOptions.None,
                },
                "compareVersion": {
                    "version": idsToGet[0],
                    "versionType": giti.GitVersionType.Commit,
                    "versionOptions": giti.GitVersionOptions.None,
                },
        } as giti.GitQueryCommitsCriteria;

        let gitChanges: giti.GitCommitRef[] = await api.getCommitsBatch(query, this.teamProject, this.teamProject);
        if (gitChanges == null || gitChanges.length === 0) {
            throw new Error("No changesets returns from API");
        }

        let returnValue: ReleaseCommit[] = gitChanges.map((x) => {
            return {
                "author": x.author.name,
                "id": x.commitId.substring(0, 8),
                "link": x.remoteUrl,
                "message": x.comment,
                "timestamp": x.author.date,
            };
        });

        return returnValue;
    }

    private async getTfvcChanges(changesInRelease: ri.Change[], connect: vsts.WebApi): Promise<ReleaseCommit[]> {
        let api: tfvc.ITfvcApi = connect.getTfvcApi();
        let idsToGet: number[] = changesInRelease.filter((x) => x.changeType === "TfsVersionControl").map((x) => Number(x.id.replace("C", "")));

        if (idsToGet.length === 0) {
            return [];
        }

        let tfvcChanges: tfcvi.TfvcChangesetRef[] = await api.getBatchedChangesets({ "changesetIds": idsToGet, "commentLength": 100, "includeLinks": true});
        if (tfvcChanges == null || tfvcChanges.length === 0) {
            throw new Error("No changesets returns from API");
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