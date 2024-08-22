import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as glob from 'glob';

export function activate(context: vscode.ExtensionContext) {
    const testController = vscode.tests.createTestController('behaveTestController', 'Behave Tests');
    context.subscriptions.push(testController);

    const featurePattern = '**/*.feature';

    const loadFeatureFile = (fileUri: vscode.Uri) => {
        const content = fs.readFileSync(fileUri.fsPath, 'utf8');
        const featureItem = testController.createTestItem(fileUri.toString(), path.basename(fileUri.fsPath), fileUri);
        const scenarios = parseFeatureFile(content);

        for (const scenario of scenarios) {
            const scenarioItem = testController.createTestItem(scenario.id, scenario.name, fileUri);
            featureItem.children.add(scenarioItem);
        }

        return featureItem;
    };

    const parseFeatureFile = (content: string) => {
        const lines = content.split('\n');
        const scenarios = [];
        let currentScenario: { name: string, id: string } | null = null;

        for (const line of lines) {
            if (line.trim().startsWith('Scenario:')) {
                if (currentScenario) {
                    scenarios.push(currentScenario);
                }
                const name = line.trim().substring(9).trim();
                const id = name.replace(/\s+/g, '-').toLowerCase();
                currentScenario = { name, id };
            }
        }

        if (currentScenario) {
            scenarios.push(currentScenario);
        }

        return scenarios;
    };

    const discoverTestsInWorkspace = async () => {
        const featureFiles = await vscode.workspace.findFiles(featurePattern);

        for (const file of featureFiles) {
            const featureItem = loadFeatureFile(file);
            testController.items.add(featureItem);
        }
    };

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.fsPath.endsWith('.feature')) {
            const featureItem = loadFeatureFile(event.document.uri);
            testController.items.add(featureItem);
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidCreateFiles(event => {
        for (const file of event.files) {
            if (file.fsPath.endsWith('.feature')) {
                const featureItem = loadFeatureFile(file);
                testController.items.add(featureItem);
            }
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(event => {
        for (const file of event.files) {
            if (file.fsPath.endsWith('.feature')) {
                testController.items.delete(file.toString());
            }
        }
    }));

    const runHandler = (request: vscode.TestRunRequest, token: vscode.CancellationToken) => {
        const run = testController.createTestRun(request);

        const runTestItem = async (testItem: vscode.TestItem) => {
            run.started(testItem);
            try {
                const scenarioName = testItem.label;
                const featureFile = testItem.uri!.fsPath;
                const command = `behave ${featureFile} -n "${scenarioName}"`;

                await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
                    text: `${command}\u000D`
                });

                run.passed(testItem);
            } catch (err) {
                run.failed(testItem, new vscode.TestMessage((err as Error).message));
            } finally {
                run.end();
            }
        };

        for (const testItem of request.include ?? []) {
            if (token.isCancellationRequested) {
                break;
            }
            runTestItem(testItem);
        }
    };

    testController.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runHandler, true);

    discoverTestsInWorkspace();
}

export function deactivate() {}
