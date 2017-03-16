import * as tl from "vsts-task-lib/task";
import * as rn from "./releaseNotesCreator";
import * as rf from "./releaseSummaryFetcher";



async function run() {
    try {
        printVersion();

        let teamProject: string = tl.getVariable("SYSTEM_TEAMPROJECT");
        let releaseDefinitionId: number = Number(tl.getVariable("RELEASE_DEFINITIONID"));
        let releaseId: number = Number(tl.getVariable("RELEASE_RELEASEID"));
        let definitionEnvironmentId: number = Number(tl.getVariable("RELEASE_DEFINITIONENVIRONMENTID"));

        let fetcher: rf.IReleaseSummaryFetcher = new rf.ReleaseSummaryFetcher(teamProject, releaseDefinitionId, releaseId, definitionEnvironmentId);
        let notes: rn.IReleaseNotesCreator = new rn.ReleaseNotesCreator(
            await fetcher.currentlyDeployedRelease(),
            await fetcher.releaseInProgress(),
            await fetcher.workItemsInRelease(),
            await fetcher.changesInRelease());

        await notes.run();
    }
    catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

function printVersion() {
    try
    {
        let taskData = require("./task.json");
        console.log(`${taskData.name}: Version: ${taskData.version.Major}.${taskData.version.Minor}.${taskData.version.Patch}`);
    }
    catch(Err)
    {
        console.log("Unkown version number");
    }
}

run();