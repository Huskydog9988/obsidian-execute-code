import {FileSystemAdapter, MarkdownRenderer, MarkdownView, Notice, Plugin} from 'obsidian';
import * as fs from "fs";
import * as os from "os"
import * as child_process from "child_process";
import piston from "piston-client";
import {Outputter} from "./Outputter";
import {ExecutorSettings, SettingsTab} from "./SettingsTab";
import {
	addInlinePlotsToPython,
	addInlinePlotsToR,
	addMagicToJS,
	addMagicToPython,
	insertNotePath,
	insertNoteTitle,
	insertVaultPath
} from "./Magic";
// @ts-ignore
import * as JSCPP from "JSCPP";
// @ts-ignore
import * as prolog from "tau-prolog";

const supportedLanguages = ["js", "javascript", "python", "cpp", "prolog", "shell", "bash", "groovy", "r", "go", "rust",
	"java", "powershell", "kotlin"];

const buttonText = "Run";

const runButtonClass = "run-code-button";
const runButtonDisabledClass = "run-button-disabled";
const hasButtonClass = "has-run-code-button";

const DEFAULT_SETTINGS: ExecutorSettings = {
	timeout: 10000,
	nodePath: "node",
	nodeArgs: "",
	pythonPath: "python",
	pythonArgs: "",
	pythonEmbedPlots: true,
	shellPath: "bash",
	shellArgs: "",
	shellFileExtension: "sh",
	groovyPath: "groovy",
	groovyArgs: "",
	groovyFileExtension: "groovy",
	golangPath: "go",
	golangArgs: "run",
	golangFileExtension: "go",
	javaPath: "java",
	javaArgs: "-ea",
	javaFileExtension: "java",
	maxPrologAnswers: 15,
	powershellPath: "powershell",
	powershellArgs: "-file",
	powershellFileExtension: "ps1",
	cargoPath: "cargo",
	cargoArgs: "run",
	rustFileExtension: "rs",
	RPath: "Rscript",
	RArgs: "",
	REmbedPlots: true,
	kotlinPath: "kotlinc",
	kotlinArgs: "-script",
	kotlinFileExtension: "kts",
}

export default class ExecuteCodePlugin extends Plugin {
	settings: ExecutorSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingsTab(this.app, this));

		this.addRunButtons(document.body);
		this.registerMarkdownPostProcessor((element, _context) => {
			this.addRunButtons(element);
		});

		// live preview renderers
		supportedLanguages.forEach(l => {
			console.debug(`Registering renderer for ${l}.`)
			this.registerMarkdownCodeBlockProcessor(`run-${l}`, async (src, el, _ctx) => {
				await MarkdownRenderer.renderMarkdown('```' + l + '\n' + src + '\n```', el, '', null)
			})
		})
	}

	onunload() {
		document
			.querySelectorAll("pre > code")
			.forEach((codeBlock: HTMLElement) => {
				const pre = codeBlock.parentElement as HTMLPreElement;
				const parent = pre.parentElement as HTMLDivElement;

				if (parent.hasClass(hasButtonClass)) {
					parent.removeClass(hasButtonClass);
				}
			});

		document
			.querySelectorAll("." + runButtonClass)
			.forEach((button: HTMLButtonElement) => button.remove());

		document
			.querySelectorAll("." + runButtonDisabledClass)
			.forEach((button: HTMLButtonElement) => button.remove());

		document
			.querySelectorAll(".clear-button")
			.forEach((button: HTMLButtonElement) => button.remove());

		document
			.querySelectorAll(".language-output")
			.forEach((out: HTMLElement) => out.remove());

		console.log("Unloaded plugin: Execute Code");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private addRunButtons(element: HTMLElement) {
		element.querySelectorAll("code")
			.forEach((codeBlock: HTMLElement) => {
				const language = codeBlock.className.toLowerCase();
				if (!language && !language.contains("language-"))
					return;

				const pre = codeBlock.parentElement as HTMLPreElement;
				const parent = pre.parentElement as HTMLDivElement;

				let srcCode = codeBlock.getText();	// get source code and perform magic to insert title etc
				const vars = this.getVaultVariables();
				if (vars) {
					srcCode = insertVaultPath(srcCode, vars.vaultPath);
					srcCode = insertNotePath(srcCode, vars.filePath);
					srcCode = insertNoteTitle(srcCode, vars.fileName);
				} else {
					console.warn(`Could not load all Vault variables! ${vars}`)
				}

				if (!parent.classList.contains(hasButtonClass)) {

					parent.classList.add(hasButtonClass);
					const button = this.createRunButton();
					pre.appendChild(button);

					const out = new Outputter(codeBlock);

					this.addListenerToButton(language, srcCode, button, out);
				}


			})
	}

	private addListenerToButton(language: string, srcCode: string, button: HTMLButtonElement, out: Outputter) {
		button.addEventListener("click", () => {
			button.className = runButtonDisabledClass;
			this.runCode(srcCode, out, button, language.replace("language-", ""));
		});

		// if (language.contains("language-js") || language.contains("language-javascript")) {
		// 	srcCode = addMagicToJS(srcCode);

		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;
		// 		this.runCode(srcCode, out, button, "js");
		// 	});

		// } else if (language.contains("java")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;
		// 		this.runCode(srcCode, out, button, "java");
		// 	});

		// } else if (language.contains("language-python")) {
		// 	button.addEventListener("click", async () => {
		// 		button.className = runButtonDisabledClass;

		// 		if (this.settings.pythonEmbedPlots)	// embed plots into html which shows them in the note
		// 			srcCode = addInlinePlotsToPython(srcCode);

		// 		srcCode = addMagicToPython(srcCode);

		// 		this.runCode(srcCode, out, button, "py");
		// 	});

		// } else if (language.contains("language-shell") || language.contains("language-bash")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;
		// 		this.runCode(srcCode, out, button, "bash");
		// 	});

		// } else if (language.contains("language-powershell")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;
		// 		this.runCode(srcCode, out, button, "powershell");
		// 	});

		// } else if (language.contains("language-cpp")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;
		// 		// out.clear();
		// 		// this.runCpp(srcCode, out);
		// 		// button.className = runButtonClass;
		// 		this.runCode(srcCode, out, button, "cpp");
		// 	})

		// } else if (language.contains("language-prolog")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;
		// 		// out.clear();

		// 		// const prologCode = srcCode.split(/\n+%+\s*query\n+/);
		// 		// if (prologCode.length < 2) return;	// no query found

		// 		// this.runPrologCode(prologCode, out);

		// 		// button.className = runButtonClass;
		// 		this.runCode(srcCode, out, button, "cpp");
		// 	})

		// } else if (language.contains("language-groovy")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;
		// 		this.runCode(srcCode, out, button, "groovy");
		// 		// this.runCodeInShell(srcCode, out, button, this.settings.groovyPath, this.settings.groovyArgs, this.settings.groovyFileExtension);
		// 	});

		// } else if (language.contains("language-rust")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;

		// 		this.runCode(srcCode, out, button, "rust");
		// 	});

		// } else if (language.contains("language-r")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;

		// 		srcCode = addInlinePlotsToR(srcCode);
		// 		console.log(srcCode);

		// 		this.runCode(srcCode, out, button, "r");
		// 	});
		// } else if (language.contains("language-go")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;

		// 		this.runCode(srcCode, out, button, "go");
		// 	});
		// } else if (language.contains("language-kotlin")) {
		// 	button.addEventListener("click", () => {
		// 		button.className = runButtonDisabledClass;
		// 		this.runCode(srcCode, out, button, "kotlin");
		// 	});
		// }
	}

	private getVaultVariables() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView == null) {
			return null;
		}

		const adapter = app.vault.adapter as FileSystemAdapter;
		const vaultPath = adapter.getBasePath();
		const folder = activeView.file.parent.path;
		const fileName = activeView.file.name
		const filePath = activeView.file.path

		return {
			vaultPath: vaultPath,
			folder: folder,
			fileName: fileName,
			filePath: filePath,
		}
	}

	private createRunButton() {
		console.debug("Add run button");
		const button = document.createElement("button");
		button.classList.add(runButtonClass);
		button.setText(buttonText);
		return button;
	}

	private getTempFile(ext: string) {
		return `${os.tmpdir()}/temp_${Date.now()}.${ext}`
	}

	private notifyError(cmd: string, cmdArgs: string, tempFileName: string, err: any, outputter: Outputter) {
		const errorMSG = `Error while executing ${cmd} ${cmdArgs} ${tempFileName}: ${err}`
		console.error(errorMSG);
		outputter.writeErr(errorMSG);
		new Notice("Error while executing code!");
	}

	private runCode(codeBlockContent: string, outputter: Outputter, button: HTMLButtonElement, lang: string) {
		new Notice("Running...");
		// const tempFileName = this.getTempFile(ext)
		// console.debug(`Execute ${cmd} ${cmdArgs} ${tempFileName}`);

		const client = piston({ server: "https://emkc.org" });

		client.execute(lang, codeBlockContent).then((result) => {
			button.className = runButtonClass;
			new Notice(result.run.code === 0 ? "Done!" : "Error!");

			outputter.write(result.run.output);
		})

		// fs.promises.writeFile(tempFileName, codeBlockContent)
		// 	.then(() => {
		// 		const args = cmdArgs ? cmdArgs.split(" ") : [];
		// 		args.push(tempFileName);

		// 		console.debug(`Execute ${cmd} ${args.join(" ")}`);
		// 		const child = child_process.spawn(cmd, args);

				// this.handleChildOutput(child, outputter, button, tempFileName);
		// 	})
		// 	.catch((err) => {
		// 		this.notifyError(cmd, cmdArgs, tempFileName, err, outputter);
		// 		button.className = runButtonClass;
		// 	});
	}

	private runCodeInShell(codeBlockContent: string, outputter: Outputter, button: HTMLButtonElement, cmd: string, cmdArgs: string, ext: string) {
		new Notice("Running...");
		const tempFileName = this.getTempFile(ext)
		console.debug(`Execute ${cmd} ${cmdArgs} ${tempFileName}`);

		fs.promises.writeFile(tempFileName, codeBlockContent)
			.then(() => {
				const args = cmdArgs ? cmdArgs.split(" ") : [];
				args.push(tempFileName);

				console.debug(`Execute ${cmd} ${args.join(" ")}`);
				const child = child_process.spawn(cmd, args, {shell: true});

				this.handleChildOutput(child, outputter, button, tempFileName);
			})
			.catch((err) => {
				this.notifyError(cmd, cmdArgs, tempFileName, err, outputter);
				button.className = runButtonClass;
			});
	}

	private runCpp(cppCode: string, out: Outputter) {
		new Notice("Running...");
		const config = {
			stdio: {
				write: (s: string) => out.write(s)
			},
			unsigned_overflow: "warn", // can be "error"(default), "warn" or "ignore"
			maxTimeout: this.settings.timeout,
		};
		const exitCode = JSCPP.run(cppCode, 0, config);

		out.write("\nprogram stopped with exit code " + exitCode);
		new Notice(exitCode === 0 ? "Done!" : "Error!");
	}

	private runPrologCode(prologCode: string[], out: Outputter) {
		new Notice("Running...");
		const session = prolog.create();
		session.consult(prologCode[0]
			, {
				success: () => {
					session.query(prologCode[1]
						, {
							success: async (goal: any) => {
								console.debug(`Prolog goal: ${goal}`)
								let answersLeft = true;
								let counter = 0;

								while (answersLeft && counter < this.settings.maxPrologAnswers) {
									await session.answer({
										success: function (answer: any) {
											new Notice("Done!");
											console.debug(`Prolog result:${session.format_answer(answer)}`);
											out.write(session.format_answer(answer) + "\n");
										},
										fail: function () {
											/* No more answers */
											answersLeft = false;
										},
										error: function (err: any) {
											new Notice("Error!");
											console.error(err);
											answersLeft = false;
											out.writeErr(`Error while executing code: ${err}`);
										},
										limit: function () {
											answersLeft = false;
										}
									});
									counter++;
								}
							},
							error: (err: any) => {
								new Notice("Error!");
								out.writeErr("Query failed.\n")
								out.writeErr(err.toString());
							}
						}
					)
				},
				error: (err: any) => {
					out.writeErr("Adding facts failed.\n")
					out.writeErr(err.toString());
				}
			}
		);
	}

	private handleChildOutput(child: child_process.ChildProcessWithoutNullStreams, outputter: Outputter, button: HTMLButtonElement, fileName: string) {
		outputter.clear();

		child.stdout.on('data', (data) => {
			outputter.write(data.toString());
		});
		child.stderr.on('data', (data) => {
			outputter.writeErr(data.toString());
		});

		child.on('close', (code) => {
			button.className = runButtonClass;
			new Notice(code === 0 ? "Done!" : "Error!");

			fs.promises.rm(fileName)
				.catch((err) => {
					console.error("Error in 'Obsidian Execute Code' Plugin while removing file: " + err);
					button.className = runButtonClass;
				});
		});

		child.on('error', (err) => {
			button.className = runButtonClass;
			new Notice("Error!");
			outputter.writeErr(err.toString());
		});
	}
}
