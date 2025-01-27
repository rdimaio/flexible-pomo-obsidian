import {addIcon, MarkdownView, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf, moment} from 'obsidian';
import * as feather from 'feather-icons'; //import just icons I want?
import {DEFAULT_SETTINGS, PomoSettings, PomoSettingTab} from './settings';
import {getDailyNoteFile, Mode, Timer} from './timer';
import FlexiblePomoWorkbench from "./workbench";
import {DEFAULT_DATA, FilePath, WorkbenchItemsListViewType} from "./workbench_data";
import {ParseUtility} from "./parse_utility";
import {WorkItem} from "./workitem";
import {WorkbenchItemsListView} from "./workbench_view";
import {SavingSuggester} from "./flexipomosuggesters/SavingSuggester";
import {LoadingSuggester} from "./flexipomosuggesters/LoadingSuggester";
import {FileUtility} from "./file_utility";
import {askCustomTimeModal} from "./custom_time_modal";

export default class FlexiblePomoTimerPlugin extends Plugin {
	settings: PomoSettings;
	statusBar: HTMLElement;
	timer: Timer;
	pomoWorkBench: FlexiblePomoWorkbench;
	parseUtility: ParseUtility;
	saving_suggester: SavingSuggester;
	loading_suggester: LoadingSuggester;
	fileUtility: FileUtility;
	opened_file_path: string;

	async onload() {
		// detach old leaves during the start. This make sure that you are always using the latest type.
		this.app.workspace.detachLeavesOfType(WorkbenchItemsListViewType);
		//reload settings during the start.
		await this.loadSettings();
		this.addSettingTab(new PomoSettingTab(this.app, this));
		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass("statusbar-pomo");
		if (this.settings.logging === true) {
			this.openLogFileOnClick();
		}
		this.timer = new Timer(this);
		/*Adds icon to the left side bar which starts the pomo timer when clicked
		  if no timer is currently running, and otherwise quits current timer*/
		if (this.settings.ribbonIcon === true) {
			this.addRibbonIcon('clock', 'Start Pomodoro', () => {
				if((this.settings.logActiveNote && (this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile)) || (!this.settings.logActiveNote)) {
					this.timer.onRibbonIconClick();
					this.pomoWorkBench.redraw();
					if(this.pomoWorkBench) {
						this.savePomoWorkBench();
					}
				} else {
					if(this.settings.logActiveNote) {
						new Notice('Please open an active note first.');
					}
				}
			});
		}
		this.pomoWorkBench = new FlexiblePomoWorkbench(this.app.workspace.activeLeaf, this, DEFAULT_DATA);
		this.fileUtility = new FileUtility(this);
		this.saving_suggester = new SavingSuggester(this);
		this.loading_suggester = new LoadingSuggester(this);
		this.registerView(
			WorkbenchItemsListViewType,
			//TODO : Fix this
			(leaf) => (this.pomoWorkBench.view = new WorkbenchItemsListView(leaf, this, this.pomoWorkBench.data, this.pomoWorkBench)),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(this.app.workspace as any).registerHoverLinkSource(
			WorkbenchItemsListViewType,
			{
				display: 'Pomo Workbench',
				defaultMod: true,
			},
		);
		if (this.app.workspace.layoutReady) {
			await this.pomoWorkBench.initView();
		} else {
			this.registerEvent(this.app.workspace.on('quit', this.pomoWorkBench.initView));
		}
		/*Update status bar timer ever half second
		  Ideally should change so only updating when in timer mode
		  - regular conditional doesn't remove after quit, need unload*/
		this.registerInterval(window.setInterval(async () =>
			this.statusBar.setText(await this.timer.setStatusBarText()), 500));

		addIcon("feather-play", feather.icons.play.toString());
		addIcon("feather-pause", feather.icons.pause.toString());
		addIcon("feather-quit", feather.icons.x.toSvg({viewBox: "0 0 24 24", width: "100", height: "100"}).toString()); //https://github.com/phibr0/obsidian-customizable-sidebar/blob/master/src/ui/icons.ts
		addIcon("feather-headphones", feather.icons.headphones.toString());

		this.addCommand({
			id: 'start-flexible-pomo',
			name: 'Start Pomodoro',
			icon: 'feather-play',
			checkCallback: (checking:boolean) => {
				if(this.settings.logActiveNote && !(this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile)) {
					return false;
				}
				if(this.isInactive()) {
					if(!checking) {
						this.settings.lastUsedPomoType = "pomo";
						this.timer = new Timer(this);
						this.timer.triggered = false;
						this.showWorkbench();
						this.timer.startTimer(Mode.Pomo);
						if(this.pomoWorkBench) {
							this.savePomoWorkBench();
						}
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'start-flexible-pomo-custom-time',
			name: 'Start Custom Pomodoro',
			icon: 'feather-play',
			checkCallback:  (checking: boolean) => {
				if (this.settings.logActiveNote && !(this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile)) {
					return false;
				}
				if (this.isInactive()) {
					if (!checking) {
						this.getAskCustomTimeModal();
						// before starting pomodoro, we need to ask for the time via an input.
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'start-flexible-last-custom-pomo',
			name: 'Start Last Custom Pomodoro',
			icon: 'feather-play',
			checkCallback:  (checking: boolean) => {
				if (this.settings.logActiveNote && !(this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile)) {
					return false;
				}
				if (this.isInactive()) {
					if (!checking) {
						this.settings.lastUsedPomoType = "pomo-custom";
						this.timer = new Timer(this);
						this.timer.triggered = false;
						this.showWorkbench();
						this.timer.startTimer(Mode.PomoCustom);
						if(this.pomoWorkBench) {
							this.savePomoWorkBench();
						}
						// before starting pomodoro, we need to ask for the time via an input.
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'start-flexible-stopwatch',
			name: 'Start Stopwatch',
			icon: 'feather-play',
			checkCallback: (checking:boolean) => {
				if(this.settings.logActiveNote && !(this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile)) {
					return false;
				}
				if(this.isInactive()) {
					if(!checking) {
						this.timer = new Timer(this);
						this.timer.triggered = false;
						this.timer.extendedTime = moment();
						this.showWorkbench();
						this.timer.startTimer(Mode.Stopwatch);
						if(this.pomoWorkBench) {
							this.savePomoWorkBench();
						}

					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'log-and-quit-flexible-pomo',
			name: 'Log Pomodoro Time and Quit.',
			icon: 'feather-log-and-quit',
			checkCallback: (checking: boolean) => {
				if (this.isActive() && this.settings.logging) {
					if (!checking) {
						this.timer.extendPomodoroTime = false;
						this.timer.triggered = false;
						this.timer.stopTimerEarly();
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'open-activenote-flexible-pomo',
			name: 'Open Active Note',
			icon: 'feather-open-active-note',
			checkCallback: (checking: boolean) => {
				if (this.timer.workItem && this.timer.workItem.activeNote && this.isActive()) {
					if (!checking) {
						let view = this.app.workspace.getActiveViewOfType(MarkdownView)
						if ( view ) {
							let file = view.file;
							if(file.basename !== this.timer.workItem.activeNote.basename) {
								let rightLeaf = this.app.workspace.splitActiveLeaf('vertical')
								this.app.workspace.setActiveLeaf(rightLeaf)
								rightLeaf.openFile(this.timer.workItem.activeNote);
							}
						}
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'start-flexible-pomo-shortbreak',
			name: 'Start Short Break',
			icon: 'feather-play',
			checkCallback: (checking: boolean) => {
				if (this.timer.mode !== Mode.Stopwatch) {
					if (!checking) {
						this.timer.startTimer(Mode.ShortBreak);
					}
					return true;
				}
				return false;
			}
		})

		this.addCommand({
			id: 'start-flexible-pomo-longbreak',
			name: 'Start Long Break',
			icon: 'feather-play',
			checkCallback: (checking: boolean) => {
				if (this.timer.mode !== Mode.Stopwatch) {
					if (!checking) {
						this.timer.startTimer(Mode.LongBreak);
					}
					return true;
				}
				return false;
			}
		})

		this.addCommand({
			id: 'pause-flexible-pomo',
			name: 'Toggle Timer Pause',
			checkCallback: (checking: boolean) => {
				if (this.isInactive()) {
					if (!checking) {
						this.timer.togglePause();
					}
					return true;
				}
				return false;
			},
			icon: 'feather-pause'
		});

		this.addCommand({
			id: 'quit-flexible-pomo',
			name: 'Quit Timer/Stopwatch',
			icon: 'feather-quit',
			checkCallback: (checking: boolean) => {
				if (this.timer.mode !== Mode.NoTimer) {
					if (!checking) {
						this.timer.quitTimer();
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'link-file-pomoworkbench',
			name: 'Link File To Active WorkBench',
			icon: 'feather-add',
			checkCallback: (checking: boolean) => {
				if (this.checkIfActive()) {
					return false;
				} else {
					if (!checking) {
						this.pomoWorkBench.linkFile((this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile), null);
						this.savePomoWorkBench();
						this.showWorkbench();
						new Notice('Linking Active Note to Workbench');
					}
					return true;
				}
			}
		});

		this.addCommand({
			id: 'unlink-file-pomoworkbench',
			name: 'Unlink File From Active Workbench',
			icon: 'feather-remove',
			checkCallback: (checking: boolean) => {
				if(this.isActive()) {
					if(this.checkIfActiveTimerOn()) {
						return false;
					}
				}
				if(!this.checkIfActive()) {
					return false;
				}
				if (!checking) {
					this.unlinkFile((this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile));
					this.savePomoWorkBench();
				}
				return true;
			}
		});

		this.addCommand({
			id: 'show-pomoworkbench',
			name: 'Show Pomo Workbench',
			icon: 'feather-show',
			callback: () => {
				this.showWorkbench();
			},
		});

		this.addCommand({
			id: 'toggle-pomoworkbench-location',
			name: 'Toggle Pomo Workbench Location',
			icon: 'feather-show',
			checkCallback: (checking) => {
				if(this.pomoWorkBench.view && this.settings.workbench_location) {
					if(!checking) {
						this.settings.workbench_location === 'left' ? this.settings.workbench_location = 'right' : this.settings.workbench_location = 'left';
						this.app.workspace.detachLeavesOfType(WorkbenchItemsListViewType);
						this.showWorkbench();
						this.saveSettings();
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'clear-pomoworkbench',
			name: 'Clear Pomo Workbench',
			icon: 'feather-clear',
			callback: () => {
				let workbenchFile:TFile = this.app.vault.getAbstractFileByPath(this.settings.active_workbench_path) as TFile;
				this.pomoWorkBench.clearWorkBench();
			}
		});

		this.addCommand({
			id: 'show-current-progress',
			name: 'Show Current Progress',
			icon: 'feather-show',
			checkCallback: (checking) => {
				if(this.isActive()) {
					if(!checking) {
						if(this.pomoWorkBench) {
							this.pomoWorkBench.current_progress_modal.openProgressModal(0);
						}
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'show-open-tasks',
			name: 'Show All Open Tasks',
			icon: 'feather-show',
			checkCallback: (checking) => {
				if(this.isActive()) {
					if(!checking) {
						if(this.pomoWorkBench) {
							this.pomoWorkBench.current_progress_modal.openProgressModal(1);
						}
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'show-all-tasks',
			name: 'Show All Tasks',
			icon: 'feather-show',
			checkCallback: (checking) => {
				if(this.isActive()) {
					if(!checking) {
						if(this.pomoWorkBench) {
							this.pomoWorkBench.current_progress_modal.openProgressModal(2);
						}
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'show-all-open-tasks-active-note',
			name: 'Show All Open Tasks Of Active Note',
			icon: 'feather-show',
			checkCallback: (checking) => {
				if(this.isActive()) {
					if(!checking) {
						if(this.pomoWorkBench) {
							this.pomoWorkBench.current_progress_modal.openProgressModal(3);
						}
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'show-all-tasks-active-note',
			name: 'Show All Tasks Of Active Note',
			icon: 'feather-show',
			checkCallback: (checking) => {
				if(this.isActive()) {
					if(!checking) {
						if(this.pomoWorkBench) {
							this.pomoWorkBench.current_progress_modal.openProgressModal(4);
						}
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'show-notes-with-active-tasks',
			name: 'Show Notes With Active Tasks',
			icon: 'feather-show',
			checkCallback: (checking) => {
				if(this.isActive()) {
					if(!checking) {
						if(this.pomoWorkBench) {
							this.pomoWorkBench.current_progress_modal.openProgressModal(5);
						}
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'toggle-flexible-pomo-white-noise',
			name: 'Toggle White noise',
			icon: 'feather-headphones',
			callback: () => {
				if (this.settings.whiteNoise) {
					this.settings.whiteNoise = false;
					this.timer.whiteNoisePlayer.stopWhiteNoise();
				} else {
					this.settings.whiteNoise = true;
					this.timer.whiteNoisePlayer.whiteNoise();
				}
			}
		});

		this.addCommand({
			id: "flexible-save-as-workbench",
			name: "Save Pomo Workbench As",
			callback: () => {
				this.pomoWorkBench.modified = false;
				this.saving_suggester.insert_template();

			},
		});

		this.addCommand({
			id: "flexible-save-workbench",
			name: "Save Pomo Workbench",
			checkCallback: (checking) => {
				if(this.settings.active_workbench_path) {
					if(!checking) {
						this.savePomoWorkBench();
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "flexible-load-workbench",
			name: "Load Pomo Workbench",
			checkCallback: (checking) => {
				if(this.isInactive()) {
					if(!checking) {
						this.loading_suggester.insert_template();
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "move-workbench-note-up",
			name: "Move Workbench Note Up",
			checkCallback: (checking) => {
				if(this.checkIfActive()) {
					if(!checking) {
						this.pomoWorkBench.shiftPositionDatafile(true);
						if(this.timer && this.isActive()) {
							this.pomoWorkBench.shiftPositionWorkItem(true);
						}
					}
					return true;
				}
				return false;
			},
		})

		this.addCommand({
			id: "move-workbench-note-down",
			name: "Move Workbench Note Down",
			checkCallback: (checking) => {
				if(this.checkIfActive()) {
					if(!checking) {
						this.pomoWorkBench.shiftPositionDatafile(false);
						if(this.timer && this.isActive()) {
							this.pomoWorkBench.shiftPositionWorkItem(false);
						}
					}
					return true;
				}
				return false;
			},
		})

		this.addCommand({
			id: "flexible-unload-workbench",
			name: "Unload Pomo Workbench",
			checkCallback: (checking) => {
				if((this.isInactive()) && this.settings.active_workbench && this.settings.active_workbench_path) {
					if(!checking) {
						this.settings.active_workbench_path = "";
						this.settings.active_workbench = "";
						if(this.pomoWorkBench.view) {
							this.pomoWorkBench.clearWorkBench();
						}
						this.saveSettings();
						new Notice('Unloaded current Workbench.');
					}
					return true;
				}
				return false;
			},
		});

		this.app.workspace.onLayoutReady(() => {
			if(this.settings.active_workbench_path) {
				if(this.settings.active_workbench_path) {
					this.fileUtility.loadItems(this.settings.active_workbench_path, null);
				}
			}
		})
		this.parseUtility = new ParseUtility(this);
		this.app.workspace.on("file-open", this.handleFileOpen);
		this.registerEvent(this.app.vault.on('delete', this.handleDelete));
		this.registerEvent(this.app.vault.on('rename', this.handleRename));
	}

	async getAskCustomTimeModal() {
		await askCustomTimeModal(this.app, "Please set your desired times.", this);

	}

	private isActive() {
		return this.timer.mode === Mode.Pomo || this.timer.mode === Mode.Stopwatch || this.timer.mode === Mode.PomoCustom;
	}

	private isInactive() {
		return this.timer.mode !== Mode.Stopwatch && this.timer.mode !== Mode.Pomo && this.timer.mode !== Mode.PomoCustom;
	}

	 savePomoWorkBench() {
		if (this.isInactive()) {
			this.pomoWorkBench.modified = false;
			this.pomoWorkBench.workItems = new Array<WorkItem>();
			this.extractWorkItems().then(value => {
				this.fileUtility.handleAppend(this.app.vault.getAbstractFileByPath(this.settings.active_workbench_path) as TFile);
			})
		} else {
			this.pomoWorkBench.modified = false;
			this.fileUtility.handleAppend(this.app.vault.getAbstractFileByPath(this.settings.active_workbench_path) as TFile);
		}
		this.pomoWorkBench.redraw();
	}

	handleClose = async () => {
		 if(!(this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile)) {
			 this.opened_file_path = '';
		 }
		 this.pomoWorkBench.redraw()
	 }


	private unlinkFile(tFile:TFile) {
		let workItemToRemove: WorkItem;
		if (this.isActive()) {
			for (const currentItem of this.pomoWorkBench.workItems) {
				if (currentItem.activeNote.path === tFile.path) {
					workItemToRemove = currentItem;
					break;
				}
			}
			if (workItemToRemove) {
				this.pomoWorkBench.modified = true;
				this.pomoWorkBench.unlinkItem(workItemToRemove);
				new Notice('Unlinking Active Note From Workbench');
			}
		} else {
			for (const dataFile of this.pomoWorkBench.data.workbenchFiles) {
				if (dataFile.path === tFile.path) {
					this.pomoWorkBench.modified = true;
					this.pomoWorkBench.data.workbenchFiles.remove(dataFile);
					break;
				}
			}
			this.pomoWorkBench.redraw();
		}
	}

	private readonly handleDelete = async (
		file: TAbstractFile,
	): Promise<void> => {
		let workbenchFileToRemove:FilePath;
		for(const workbenchFile of this.pomoWorkBench.data.workbenchFiles) {
			if(workbenchFile.path === file.path) {
				workbenchFileToRemove = workbenchFile;
				break;
			}
		}
		if(workbenchFileToRemove) {
			this.unlinkFile(file as TFile);
		}
	};


	private readonly handleRename = async (
		file: TAbstractFile,
		oldPath: string,
	): Promise<void> => {
		console.log('old path is ' + oldPath);
		let workbenchFileToRemove:FilePath;
		for(const workbenchFile of this.pomoWorkBench.data.workbenchFiles) {
			if(workbenchFile.path === oldPath) {
				workbenchFileToRemove = workbenchFile;
				break;
			}
		}
		if(workbenchFileToRemove) {
			this.pomoWorkBench.data.workbenchFiles.remove(workbenchFileToRemove);
		}
		if(this.isActive()) {
			let workItemToRemove:WorkItem;
			for(const workItem of this.pomoWorkBench.workItems) {
				if(workItem.activeNote.path === oldPath) {
					workItemToRemove = workItem;
					break;
				}
			}
			if(workItemToRemove) {
				this.pomoWorkBench.workItems.remove(workItemToRemove);
			}
		}
		if(workbenchFileToRemove) {
			this.pomoWorkBench.modified = true;
			if((this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().path : this.app.workspace.lastActiveFile) === file.path) {
				this.opened_file_path = file.path;
			}
			this.pomoWorkBench.linkFile(file as TFile, null);
		}
		this.pomoWorkBench.redraw();
	};

	handleFileOpen = async (tFile: TFile):Promise<void> => {
		if(tFile) {
			this.opened_file_path = tFile.path;
			this.pomoWorkBench.redraw();
		}
	}

	private async extractWorkItems() {
		for (const workBenchFile of this.pomoWorkBench.data.workbenchFiles) {
			const tFile: TFile = this.app.vault.getAbstractFileByPath(workBenchFile.path) as TFile;
			let workItem: WorkItem = new WorkItem(tFile, true);
			await this.parseUtility.gatherLineItems(workItem, workItem.initialPomoTaskItems, true, workItem.activeNote);
		}
	}

	  async showWorkbench() {
		if (this.app.workspace.getLeavesOfType(WorkbenchItemsListViewType).length) {
			await this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(WorkbenchItemsListViewType).first());
		} else {
			if(this.settings.workbench_location && this.settings.workbench_location === 'left') {
				await this.app.workspace.getLeftLeaf(false).setViewState({
					type: WorkbenchItemsListViewType,
				})
			} else if(this.settings.workbench_location && this.settings.workbench_location === 'right'){
				await this.app.workspace.getRightLeaf(false).setViewState({
					type: WorkbenchItemsListViewType,
				})
			} else {
				await this.app.workspace.getRightLeaf(false).setViewState({
					type: WorkbenchItemsListViewType,
				})
			}
			await this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(WorkbenchItemsListViewType).first());
		}
	}

	private checkIfActive():boolean {
		if (this.pomoWorkBench && this.pomoWorkBench.data.workbenchFiles.length && (this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile)) {
			for (const currentFile of this.pomoWorkBench.data.workbenchFiles) {
				if (currentFile.path === (this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().path : this.app.workspace.lastActiveFile.path)) {
					return true;
				}
			}
			return false;
		}
	}

	private checkIfActiveTimerOn():boolean {
		if (this.pomoWorkBench && this.pomoWorkBench.workItems.length && (this.app.workspace.getActiveFile() || this.app.workspace.lastActiveFile)) {
			for (const currentItem of this.pomoWorkBench.workItems) {
				if (currentItem.isStartedActiveNote &&  currentItem.activeNote.path === (this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().path : this.app.workspace.lastActiveFile.path)) {
					return true;
				}
			}
			return false;
		}
	}

//on click, open log file; from Day Planner https://github.com/lynchjames/obsidian-day-planner/blob/c8d4d33af294bde4586a943463e8042c0f6a3a2d/src/status-bar.ts#L53
	openLogFileOnClick() {
		this.statusBar.addClass("statusbar-pomo-logging");
		this.statusBar.onClickEvent(async (ev: any) => {
			if (this.settings.logging === true) { //this is hacky, ideally I'd just unwatch the onClickEvent as soon as I turned logging off
				try {
					var file: string;
					if (this.settings.logToDaily === true) {
						file = (await getDailyNoteFile()).path;
					} else {
						file = this.settings.logFile;
					}
					this.app.workspace.openLinkText(file, '', false);
				} catch (error) {
				}
			}
		});
	}

	/**************  Meta  **************/
	onunload() {
		try {
			if (this.timer.win) {
				this.timer.win.close();
			}
		} catch (e) {
		}
		this.timer.quitTimer();
		(this.app.workspace as any).unregisterHoverLinkSource(
			WorkbenchItemsListViewType,
		);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}


}