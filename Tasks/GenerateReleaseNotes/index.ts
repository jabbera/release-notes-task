import * as fs from "fs";
import * as mailer from "nodemailer";
import * as wi from "vso-node-api/interfaces/WorkItemTrackingInterfaces";
import * as tl from "vsts-task-lib/task";
import * as rn from "./releaseNotesCreator";
import * as rf from "./releaseSummaryFetcher";

async function run() {
    try {
        let teamProject: string = tl.getVariable("SYSTEM_TEAMPROJECT");
        let releaseDefinitionId: number = Number(tl.getVariable("RELEASE_DEFINITIONID"));
        let releaseId: number = Number(tl.getVariable("RELEASE_ID"));
        let definitionEnvironmentId: number = Number(tl.getVariable("RELEASE_DEFINITIONENVIRONMENTID"));

        let fetcher: rf.IReleaseSummaryFetcher = new rf.ReleaseSummaryFetcher(teamProject, releaseDefinitionId, releaseId, definitionEnvironmentId);
        let notes: rn.IReleaseNotesCreator = new rn.ReleaseNotesCreator(
            await fetcher.currentlyDeployedRelease(),
            await fetcher.releaseInProgress(),
            await fetcher.workItemsInRelease());

        await notes.run();
    }
    catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

run();