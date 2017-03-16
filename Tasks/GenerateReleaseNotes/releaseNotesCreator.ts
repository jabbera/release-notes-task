import * as fs from "fs";
import * as wi from "vso-node-api/interfaces/WorkItemTrackingInterfaces";
import * as tl from "vsts-task-lib/task";

export interface IReleaseNotesCreator {
    run(): Promise<void>;
};

export class ReleaseNotesCreator implements IReleaseNotesCreator {
    private currentlyDeployedRelease: ReleaseSummaryInformation;
    private releaseInProgress: ReleaseSummaryInformation;
    private workItemsInRelease: wi.WorkItem[] = [];
    private changesInRelease: ReleaseCommit[] = [];

    constructor(currentlyDeployedRelease: ReleaseSummaryInformation,
                releaseInProgress: ReleaseSummaryInformation,
                workItemsInRelease: wi.WorkItem[],
                changesInRelease: ReleaseCommit[]) {
        if (currentlyDeployedRelease == null) {
            throw new Error("No current release");
        }

        if (releaseInProgress == null) {
            throw new Error("No current release");
        }

        this.currentlyDeployedRelease = currentlyDeployedRelease;
        this.releaseInProgress = releaseInProgress;
        this.workItemsInRelease = workItemsInRelease;
        this.changesInRelease = changesInRelease;
    }

    public async run() {
        let outputVariable: string = tl.getInput("OutputVariable", true);
        let outputFileLocation: string = tl.getInput("OutputFileLocation");

        let cssFile: string = this.getCssFile();

        let css: string = fs.readFileSync(cssFile, "utf-8");

        let body: string = "<html><meta charset=\"UTF-8\"><head><style type=\"text/css\">" + css + "</style></head><body>";

        body = this.addProductName(body, this.currentlyDeployedRelease.definitionName);
        body = this.addReleaseSummary(body, this.currentlyDeployedRelease, this.releaseInProgress);
        body = this.addWorkItems(body, this.workItemsInRelease);
        body = this.addChanges(body, this.changesInRelease);

        body += "</body></html>";

        // setVariable can't take CR\LF inline.
        body = body.replace(/\r?\n/g, "");

        tl.setVariable(outputVariable, body);

        if (outputFileLocation != null && outputFileLocation.length > 0) {
            tl.writeFile(outputFileLocation, body, {"encoding": "utf-8"});
        }

        console.log(this.workItemsInRelease.length);
    }

    private addWorkItems(body: string, workItemsInRelease: wi.WorkItem[]): string {
        if (workItemsInRelease.length === 0) {
            return body;
        }

        body += "<p id=\"workitems-header\">Workitems Updated</p><table id=workitems> \
                <tr> \
                    <th></th><th>Id</th><th>Title</th><th>State</th> \
                </tr><br>";

        let isOdd: boolean = true;
        for (let item of workItemsInRelease) {
            body += `<tr ${this.getRowStyle(isOdd)}><td ${this.getTypeCellStyle(item)}>█</td><td><a href="${item.url}">${item.id}</a></td><td>${item.fields["System.Title"]}</td><td>${item.fields["System.State"]}</td></tr>`;
            isOdd = !isOdd;
        }

        body += "</table>";
        return body;
    }

    private addChanges(body: string, changesInRelease: ReleaseCommit[]): string {
        if (changesInRelease.length === 0) {
            return body;
        }

        body += "<p id=\"changes-header\">Changes Committed</p><table id=changes> \
                <tr> \
                    <th>Id</th><th>Message</th><th>Author</th><th>Timestamp</th> \
                </tr>";

        let isOdd: boolean = true;
        for (let item of changesInRelease) {
            body += `<tr ${this.getRowStyle(isOdd)}><td><a href="${item.link}">${item.id}</a></td><td>${item.message}</td><td>${item.author}</td><td>${item.timestamp.toLocaleString()}</td></tr>`;
            isOdd = !isOdd;
        }

        body += "</table>";
        return body;
    }

    private addProductName(body: string, productName: string): string {
        let additionalBody: string = `<p id="product-name">${productName}</p><br>`;

        return body + additionalBody;
    }

    private addReleaseSummary(body: string, currentReleaseSummary: ReleaseSummaryInformation, lastReleaseSummary: ReleaseSummaryInformation): string {
        let additionalBody: string = `<p id="new-version">Version: <a href="${currentReleaseSummary.buildWebLink}">${currentReleaseSummary.buildVersion}</a> has been released to: <a href="${currentReleaseSummary.releaseWebLink}">${currentReleaseSummary.environmentName}</a></p><br>`;

        return body + additionalBody;
    }

    private getRowStyle(isOdd: boolean): string {
        if (isOdd) {
            return "";
        }

        return "class=\"tr-even\"";
    }

    private getTypeCellStyle(item: wi.WorkItem): string {
        return `class="td-${item.fields["System.WorkItemType"].replace(/\s/g, "")}"`;
    }

    private getCssFile(): string {
        if (tl.filePathSupplied("CssFile")) {
            return tl.getPathInput("CssFile", true, true);
        }

        return tl.resolve(__dirname, "defaultStyle.css");
    }
}