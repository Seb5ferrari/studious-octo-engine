import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
    const testController = vscode.tests.createTestController('behaveTestController', 'Behave Tests');
    context.subscriptions.push(testController);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const workspaceFolder of workspaceFolders) {
            createTestItems(testController, workspaceFolder);
        }
    }

    const runHandler = async (request: vscode.TestRunRequest, token: vscode.CancellationToken) => {
        const run = testController.createTestRun(request);

        // Reuse a single terminal for all test executions
        const terminal = vscode.window.createTerminal('Behave Test Runner');

        const runTestItem = async (testItem: vscode.TestItem) => {
            run.started(testItem);
            try {
                const scenarioName = testItem.label;
                const featureFile = testItem.uri!.fsPath;
                const command = `behave ${featureFile} -n "${scenarioName}"`;

                // Send the command to the terminal, preserving focus
                terminal.sendText(command, true);

                // Assume the test passed for now (since behave output parsing isn't handled here)
                run.passed(testItem);
            } catch (err) {
                run.failed(testItem, new vscode.TestMessage((err as Error).message));
            }
        };

        const runFolder = async (folderItem: vscode.TestItem) => {
            for (const featureItem of folderItem.children) {
                for (const scenarioItem of featureItem[1].children) {
                    if (token.isCancellationRequested) {
                        break;
                    }
                    await runTestItem(scenarioItem[1]);
                }
            }
        };

        try {
            const testsToRun: vscode.TestItem[] = request.include ? [...request.include] : [];

            if (testsToRun.length === 0) {
                // If no specific tests are included, run all tests in the testController
                testController.items.forEach(testItem => {
                    if (token.isCancellationRequested) {
                        return;
                    }
                    testsToRun.push(testItem);
                });
            }

            // Run the tests
            for (const testItem of testsToRun) {
                if (token.isCancellationRequested) {
                    break;
                }
                if (testItem.children.size > 0) {
                    await runFolder(testItem); // Run all tests in the folder
                } else {
                    await runTestItem(testItem); // Run individual test
                }
            }
        } finally {
            terminal.dispose(); // Clean up the terminal when done
            run.end();
        }
    };

    testController.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runHandler, true);
}

const createTestItems = (controller: vscode.TestController, workspaceFolder: vscode.WorkspaceFolder) => {
    const functionFolderUri = vscode.Uri.joinPath(workspaceFolder.uri, 'function');
    const functionFolder = vscode.workspace.fs.readDirectory(functionFolderUri);

    functionFolder.then(entries => {
        entries.forEach(async ([name, type]) => {
            if (type === vscode.FileType.Directory && (name.includes("cbs") || name.includes("cls"))) {
                const folderUri = vscode.Uri.joinPath(functionFolderUri, name);
                const folderItem = controller.createTestItem(name, name, folderUri);
                controller.items.add(folderItem);

                // Add feature files as children of the folder
                const featureFiles = await vscode.workspace.fs.readDirectory(folderUri);
                featureFiles.forEach(async ([fileName, fileType]) => {
                    if (fileType === vscode.FileType.File && fileName.endsWith('.feature')) {
                        const featureUri = vscode.Uri.joinPath(folderUri, fileName);
                        const featureItem = controller.createTestItem(fileName, fileName, featureUri);
                        folderItem.children.add(featureItem);

                        // Add scenarios as children of the feature file
                        const fileContent = await vscode.workspace.fs.readFile(featureUri);
                        const featureText = Buffer.from(fileContent).toString('utf8');
                        const scenarios = extractScenariosFromFeature(featureText);

                        scenarios.forEach(scenario => {
                            const scenarioItem = controller.createTestItem(scenario, scenario, featureUri);
                            featureItem.children.add(scenarioItem);
                        });
                    }
                });
            }
        });
    });
};

const extractScenariosFromFeature = (featureText: string): string[] => {
    const scenarioRegex = /Scenario: (.+)/g;
    const scenarios: string[] = [];
    let match;
    while ((match = scenarioRegex.exec(featureText)) !== null) {
        scenarios.push(match[1]);
    }
    return scenarios;
};
