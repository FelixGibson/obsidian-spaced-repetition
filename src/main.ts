import {
    Notice,
    Plugin,
    TAbstractFile,
    TFile,
    HeadingCache,
    getAllTags,
    FrontMatterCache,
    Platform,
    App,
} from "obsidian";
import * as graph from "pagerank.js";

import { SRSettingTab, SRSettings, DEFAULT_SETTINGS, applySettingsUpdate } from "src/settings";
import { FlashcardModal, Deck } from "src/flashcard-modal";
import { StatsModal, Stats } from "src/stats-modal";
import { ReviewQueueListView, REVIEW_QUEUE_VIEW_TYPE } from "src/sidebar";
import { Card, CardType, ReviewResponse, schedule } from "src/scheduling";
import {
    YAML_FRONT_MATTER_REGEX,
    SCHEDULING_INFO_REGEX,
    LEGACY_SCHEDULING_EXTRACTOR,
    MULTI_SCHEDULING_EXTRACTOR,
} from "src/constants";
import { escapeRegexString, cyrb53 } from "src/utils";
import { ReviewDeck, ReviewDeckSelectionModal } from "src/review-deck";
import { t } from "src/lang/helpers";
import { parse, escapeRegex, NO_TAG } from "src/parser";
import { appIcon } from "src/icons/appicon";

interface PluginData {
    settings: SRSettings;
    buryDate: string;
    // hashes of card texts
    // should work as long as user doesn't modify card's text
    // which covers most of the cases
    buryList: string[];
    historyDeck: string | null;
}

const DEFAULT_DATA: PluginData = {
    settings: DEFAULT_SETTINGS,
    buryDate: "",
    buryList: [],
    historyDeck: null,
};

type MultiTagsObj = {
    name: string;
    tags: string[];
};

export interface SchedNote {
    note: TFile;
    dueUnix: number;
}

export interface LinkStat {
    sourcePath: string;
    linkCount: number;
}

export default class SRPlugin extends Plugin {
    public statusBar: HTMLElement;
    private reviewQueueView: ReviewQueueListView;
    public data: PluginData;
    public syncLock = false;
    public cacheDeckString = "";

    public reviewDecks: { [deckKey: string]: ReviewDeck } = {};
    public lastSelectedReviewDeck: string;

    public newNotes: TFile[] = [];
    public scheduledNotes: SchedNote[] = [];
    public easeByPath: Record<string, number> = {};
    private incomingLinks: Record<string, LinkStat[]> = {};
    private pageranks: Record<string, number> = {};
    private dueNotesCount = 0;
    public dueDatesNotes: Record<number, number> = {}; // Record<# of days in future, due count>

    public static deckTree: Deck | null;
    public dueDatesFlashcards: Record<number, number> = {}; // Record<# of days in future, due count>
    public cardStats: Stats;

    jsonToCard(json: any): Card {
        const tmp: TAbstractFile = this.app.vault.getAbstractFileByPath(json.note);
        if (tmp instanceof TFile) {
            tmp as TFile;
            return {
                isDue: json.isDue,
                interval: json.interval,
                ease: json.ease,
                delayBeforeReview: json.delayBeforeReview,
                note: tmp,
                lineNo: json.lineNo,
                front: json.front,
                back: json.back,
                cardText: json.cardText,
                context: json.context,
                cardType: json.cardType,
                siblingIdx: 0,
                siblings: [],
            };
        } else {
            // const res = new TFile(json.note, "");
            // return {
            //     isDue: json.isDue,
            //     interval: json.interval,
            //     ease: json.ease,
            //     delayBeforeReview: json.delayBeforeReview,
            //     note: res,
            //     lineNo: json.lineNo,
            //     front: json.front,
            //     back: json.back,
            //     cardText: json.cardText,
            //     context: json.context,
            //     cardType: json.cardType,
            //     siblingIdx: 0,
            //     siblings: [],
            // };
            console.log("SR: Error loading card", json);
        }
    }

    jsonToDeck(obj: any, parent: Deck | null = null): Deck {
        const deck = new Deck(obj.deckTag, parent);
        let newFlashcards = [];
        let dueFlashcards = [];

        for (let i = 0; i < obj.newFlashcards.length; i++) {
            let card = this.jsonToCard(obj.newFlashcards[i]);
            if (card !== undefined) {
                newFlashcards.push(card);
            }
        }

        for (let i = 0; i < obj.dueFlashcards.length; i++) {
            let card = this.jsonToCard(obj.dueFlashcards[i]);
            if (card !== undefined) {
                dueFlashcards.push(card);
            }
        }

        deck.newFlashcards = newFlashcards;
        deck.newFlashcardsCount = obj.newFlashcardsCount;
        deck.dueFlashcards = dueFlashcards;
        deck.dueFlashcardsCount = obj.dueFlashcardsCount;
        deck.totalFlashcards = obj.totalFlashcards;
        deck.originCount = obj.originCount;
        deck.subdecks = (obj.subdecks || []).map((subdeckObj: any) =>
            this.jsonToDeck(subdeckObj, deck)
        );
        return deck;
    }

    async onload(): Promise<void> {
        await this.loadPluginData();

        appIcon();

        this.statusBar = this.addStatusBarItem();
        this.statusBar.setText(`profit: ${this.data.settings.profit}`);
        // this.statusBar.classList.add("mod-clickable");
        // this.statusBar.setAttribute("aria-label", t("OPEN_NOTE_FOR_REVIEW"));
        // this.statusBar.setAttribute("aria-label-position", "top");
        // this.statusBar.addEventListener("click", async () => {
        //     if (!this.syncLock) {
        //         await this.sync();
        //         this.reviewNextNoteModal();
        //     }
        // });

        this.addRibbonIcon("SpacedRepIcon", t("REVIEW_CARDS"), async () => {
            if (!this.syncLock) {
                await this.sync();
                new FlashcardModal(this.app, this).open();
            }
        });
        document.addEventListener(
            "keydown",
            async (e) => {
                if (e.code === "KeyR" && e.ctrlKey) {
                    if (!this.syncLock) {
                        await this.sync();
                        new FlashcardModal(this.app, this).open();
                    }
                }
            },
            true
        );

        this.registerView(
            REVIEW_QUEUE_VIEW_TYPE,
            (leaf) => (this.reviewQueueView = new ReviewQueueListView(leaf, this))
        );

        if (!this.data.settings.disableFileMenuReviewOptions) {
            this.registerEvent(
                this.app.workspace.on("file-menu", (menu, fileish: TAbstractFile) => {
                    if (fileish instanceof TFile && fileish.extension === "md") {
                        menu.addItem((item) => {
                            item.setTitle(t("REVIEW_EASY_FILE_MENU"))
                                .setIcon("SpacedRepIcon")
                                .onClick(() => {
                                    this.saveReviewResponse(fileish, ReviewResponse.Easy);
                                });
                        });

                        menu.addItem((item) => {
                            item.setTitle(t("REVIEW_GOOD_FILE_MENU"))
                                .setIcon("SpacedRepIcon")
                                .onClick(() => {
                                    this.saveReviewResponse(fileish, ReviewResponse.Good);
                                });
                        });

                        menu.addItem((item) => {
                            item.setTitle(t("REVIEW_HARD_FILE_MENU"))
                                .setIcon("SpacedRepIcon")
                                .onClick(() => {
                                    this.saveReviewResponse(fileish, ReviewResponse.Hard);
                                });
                        });
                    }
                })
            );
        }

        this.addCommand({
            id: "srs-note-review-open-note",
            name: t("OPEN_NOTE_FOR_REVIEW"),
            callback: async () => {
                if (!this.syncLock) {
                    await this.sync();
                    this.reviewNextNoteModal();
                }
            },
        });

        this.addCommand({
            id: "srs-note-review-easy",
            name: t("REVIEW_NOTE_EASY_CMD"),
            callback: () => {
                const openFile: TFile | null = this.app.workspace.getActiveFile();
                if (openFile && openFile.extension === "md") {
                    this.saveReviewResponse(openFile, ReviewResponse.Easy);
                }
            },
        });

        this.addCommand({
            id: "srs-note-review-good",
            name: t("REVIEW_NOTE_GOOD_CMD"),
            callback: () => {
                const openFile: TFile | null = this.app.workspace.getActiveFile();
                if (openFile && openFile.extension === "md") {
                    this.saveReviewResponse(openFile, ReviewResponse.Good);
                }
            },
        });

        this.addCommand({
            id: "srs-note-review-hard",
            name: t("REVIEW_NOTE_HARD_CMD"),
            callback: () => {
                const openFile: TFile | null = this.app.workspace.getActiveFile();
                if (openFile && openFile.extension === "md") {
                    this.saveReviewResponse(openFile, ReviewResponse.Hard);
                }
            },
        });

        this.addCommand({
            id: "srs-review-flashcards",
            name: t("REVIEW_ALL_CARDS"),
            callback: async () => {
                if (!this.syncLock) {
                    await this.sync();
                    new FlashcardModal(this.app, this).open();
                }
            },
        });

        this.addCommand({
            id: "srs-review-flashcards-in-note",
            name: t("REVIEW_CARDS_IN_NOTE"),
            callback: async () => {
                const openFile: TFile | null = this.app.workspace.getActiveFile();
                if (openFile && openFile.extension === "md") {
                    SRPlugin.deckTree = new Deck("root", null);
                    const deckPath: string[] = this.findDeckPath(openFile);
                    await this.findFlashcardsInNote(openFile, deckPath);
                    new FlashcardModal(this.app, this).open();
                }
            },
        });

        this.addCommand({
            id: "   srs-cram-flashcards-in-note",
            name: t("CRAM_CARDS_IN_NOTE"),
            callback: async () => {
                const openFile: TFile | null = this.app.workspace.getActiveFile();
                if (openFile && openFile.extension === "md") {
                    SRPlugin.deckTree = new Deck("root", null);
                    const deckPath: string[] = this.findDeckPath(openFile);
                    await this.findFlashcardsInNote(openFile, deckPath, false, true);
                    new FlashcardModal(this.app, this, true).open();
                }
            },
        });

        // this.addCommand({
        //     id: "srs-view-stats",
        //     name: t("VIEW_STATS"),
        //     callback: async () => {
        //         if (!this.syncLock) {
        //             await this.sync();
        //             new StatsModal(this.app, this).open();
        //         }
        //     },
        // });

        this.addSettingTab(new SRSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(() => {
            this.initView();
            setTimeout(async () => {
                if (!this.syncLock) {
                    await this.sync();
                }
            }, 2000);
        });
    }

    onunload(): void {
        this.app.workspace.getLeavesOfType(REVIEW_QUEUE_VIEW_TYPE).forEach((leaf) => leaf.detach());
    }

    async sync(): Promise<void> {
        if (this.syncLock) {
            return;
        }
        this.syncLock = true;

        try {
            // reset notes stuff
            graph.reset();
            this.easeByPath = {};
            this.incomingLinks = {};
            this.pageranks = {};
            this.dueNotesCount = 0;
            this.dueDatesNotes = {};
            this.reviewDecks = {};

            // if the history is not null, just restore deckTree and return
            if (SRPlugin.deckTree !== undefined) {
                const arrayOld = SRPlugin.deckTree.getSubdecksList(
                    this.data.settings.excludeFlashcardTags
                );
                const arrayNew = this.data.settings.flashcardTags;
                const isSame =
                    arrayOld.length === arrayNew.length &&
                    arrayOld.every((value, index) => value === arrayNew[index]);
                if (isSame) {
                    this.syncLock = false;
                    return;
                }
            }

            // 获取当前北京时间
            const now = window.moment().utcOffset(8); // 设置为 UTC+8
            const todayDate = now.format("YYYY-MM-DD");

            const isFirstSyncToday = todayDate !== this.data.settings.lastSyncDate;

            if (!isFirstSyncToday && this.cacheDeckString) {
                SRPlugin.deckTree = this.jsonToDeck(JSON.parse(this.cacheDeckString));
                if (this.data.settings.showDebugMessages) {
                    console.log(`SR: ${t("DECKS")}`, SRPlugin.deckTree);
                }
                this.syncLock = false;
                return;
            }

            // reset flashcards stuff
            SRPlugin.deckTree = new Deck("root", null);
            this.dueDatesFlashcards = {};
            this.cardStats = {
                eases: {},
                intervals: {},
                newCount: 0,
                youngCount: 0,
                matureCount: 0,
            };

            // clear bury list if we've changed dates
            if (todayDate !== this.data.buryDate) {
                this.data.buryDate = todayDate;
                this.data.buryList = [];
            }
            await this.resetFlashcardTags();
            const isValid = this.checkTagIsValid();
            if (!isValid) {
                this.syncLock = false;
                return;
            }
            for (const tag of this.data.settings.flashcardTags) {
                SRPlugin.deckTree.createDeck([tag]);
            }

            const notes: TFile[] = this.app.vault.getMarkdownFiles();
            for (const note of notes) {
                if (
                    this.data.settings.noteFoldersToIgnore.some((folder) =>
                        note.path.startsWith(folder)
                    )
                ) {
                    continue;
                }

                if (this.incomingLinks[note.path] === undefined) {
                    this.incomingLinks[note.path] = [];
                }

                const links = this.app.metadataCache.resolvedLinks[note.path] || {};
                for (const targetPath in links) {
                    if (this.incomingLinks[targetPath] === undefined)
                        this.incomingLinks[targetPath] = [];

                    // markdown files only
                    if (targetPath.split(".").pop().toLowerCase() === "md") {
                        this.incomingLinks[targetPath].push({
                            sourcePath: note.path,
                            linkCount: links[targetPath],
                        });

                        graph.link(note.path, targetPath, links[targetPath]);
                    }
                }

                const deckPath: string[] = this.findDeckPath(note);
                const flashcardsInNoteAvgEase: number = await this.findFlashcardsInNote(
                    note,
                    deckPath
                );

                if (flashcardsInNoteAvgEase > 0) {
                    this.easeByPath[note.path] = flashcardsInNoteAvgEase;
                }

                const fileCachedData = this.app.metadataCache.getFileCache(note) || {};

                const frontmatter: FrontMatterCache | Record<string, unknown> =
                    fileCachedData.frontmatter || {};
                const tags = getAllTags(fileCachedData) || [];

                let shouldIgnore = true;
                const matchedNoteTags = [];

                for (const tagToReview of this.data.settings.tagsToReview) {
                    if (
                        tags.some((tag) => tag === tagToReview || tag.startsWith(tagToReview + "/"))
                    ) {
                        if (!Object.prototype.hasOwnProperty.call(this.reviewDecks, tagToReview)) {
                            this.reviewDecks[tagToReview] = new ReviewDeck(tagToReview);
                        }
                        matchedNoteTags.push(tagToReview);
                        shouldIgnore = false;
                        break;
                    }
                }
                if (shouldIgnore) {
                    continue;
                }

                // file has no scheduling information
                if (
                    !(
                        Object.prototype.hasOwnProperty.call(frontmatter, "sr-due") &&
                        Object.prototype.hasOwnProperty.call(frontmatter, "sr-interval") &&
                        Object.prototype.hasOwnProperty.call(frontmatter, "sr-ease")
                    )
                ) {
                    for (const matchedNoteTag of matchedNoteTags) {
                        this.reviewDecks[matchedNoteTag].newNotes.push(note);
                    }
                    continue;
                }

                const dueUnix: number = window
                    .moment(frontmatter["sr-due"], ["YYYY-MM-DD", "DD-MM-YYYY", "ddd MMM DD YYYY"])
                    .valueOf();

                for (const matchedNoteTag of matchedNoteTags) {
                    this.reviewDecks[matchedNoteTag].scheduledNotes.push({ note, dueUnix });
                    if (dueUnix <= now.valueOf()) {
                        this.reviewDecks[matchedNoteTag].dueNotesCount++;
                    }
                }

                if (Object.prototype.hasOwnProperty.call(this.easeByPath, note.path)) {
                    this.easeByPath[note.path] =
                        (this.easeByPath[note.path] + frontmatter["sr-ease"]) / 2;
                } else {
                    this.easeByPath[note.path] = frontmatter["sr-ease"];
                }

                if (dueUnix <= now.valueOf()) {
                    this.dueNotesCount++;
                }

                const nDays: number = Math.ceil((dueUnix - now.valueOf()) / (24 * 3600 * 1000));
                if (!Object.prototype.hasOwnProperty.call(this.dueDatesNotes, nDays)) {
                    this.dueDatesNotes[nDays] = 0;
                }
                this.dueDatesNotes[nDays]++;
            }

            graph.rank(0.85, 0.000001, (node: string, rank: number) => {
                this.pageranks[node] = rank * 10000;
            });

            await this.processDeckHierarchy(); // 替换原来的for循环逻辑

            // sort the deck names
            SRPlugin.deckTree.sortSubdecksList(this.data.settings.flashcardTags);
            SRPlugin.deckTree.sortFlashcards();
            if (this.data.settings.showDebugMessages) {
                console.log(`SR: ${t("EASES")}`, this.easeByPath);
                console.log(`SR: ${t("DECKS")}`, SRPlugin.deckTree);
            }

            if (SRPlugin.deckTree !== null) {
                // store the deckTree to local files
                const cacheDeckString = JSON.stringify(
                    SRPlugin.deckTree.toJSONWithLimit(this.data.settings.tagLimits)
                );
                this.cacheDeckString = cacheDeckString;
                this.data.settings.lastSyncDate = now.format("YYYY-MM-DD");
                await this.savePluginData();
            }

            for (const deckKey in this.reviewDecks) {
                this.reviewDecks[deckKey].sortNotes(this.pageranks);
            }

            if (this.data.settings.showDebugMessages) {
                console.log(
                    "SR: " +
                        t("SYNC_TIME_TAKEN", {
                            t: Date.now() - now.valueOf(),
                        })
                );
            }

            // this.statusBar.setText(
            //     t("STATUS_BAR", {
            //         dueNotesCount: this.dueNotesCount,
            //         dueFlashcardsCount: SRPlugin.deckTree.dueFlashcardsCount,
            //     })
            // );
            if (this.reviewQueueView !== undefined) {
                this.reviewQueueView.redraw();
            }

            await this.printNoTag();
        } finally {
            this.syncLock = false;
        }
    }

    private deduplicateDeckCards(deck: Deck): void {
        if (!deck) return;
        deck.newFlashcards = this.deduplicateCards(deck.newFlashcards);
        deck.dueFlashcards = this.deduplicateCards(deck.dueFlashcards);
    }

    private deduplicateCards(cards: Card[]): Card[] {
        const uniqueCardsMap = new Map<string, Card>();
        for (const card of cards) {
            const uniqueKey = `${card.note.path}-${card.cardText}`;
            if (!uniqueCardsMap.has(uniqueKey)) {
                uniqueCardsMap.set(uniqueKey, card);
            }
        }
        return Array.from(uniqueCardsMap.values());
    }

    private async processDeckHierarchy() {
        const maxLevel = 6;
        const deckLevels: DeckLevel[] = Array.from({ length: maxLevel }, () => ({
            prefix: "",
            parentDeck: null,
        }));
        const processTagFile = async (tag: string) => {
            const tagContent = tag.match(/#\[\[(.*?)\]\]/)?.[1] || tag.replace(/^#/, "");
            // 定义需要检查的两个目标标签
            const targetTags = ["#[[cheatsheet]]", "#[[anti-model]]"];
            const filePath = `pages/${tagContent}.md`;

            try {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    // 找出缺失的标签
                    const missingTags = targetTags.filter((t) => !content.includes(t));

                    if (missingTags.length > 0) {
                        // 只为缺失的标签生成内容
                        const appendContent = missingTags.map((t) => `- ${t} ;; `).join("\n");
                        await this.app.vault.append(file, `\n${appendContent}`);
                        console.log(`SR: 已添加缺失标签 ${missingTags.join(", ")} 到 ${filePath}`);
                    }
                }
            } catch (error) {
                console.error(`SR: 处理 ${filePath} 时出错:`, error);
            }
        };

        for (const deckTag of this.data.settings.flashcardTags) {
            const level = (deckTag.match(/^\|+/)?.[0]?.length || 0) - 1;

            // 处理层级标记
            if (level >= 0 && level < maxLevel) {
                // 处理前一个层级的卡片去重
                if (deckLevels[level].prefix) {
                    this.deduplicateDeckCards(deckLevels[level].parentDeck);
                }

                // 设置新层级
                deckLevels[level].prefix = deckTag;
                deckLevels[level].parentDeck =
                    SRPlugin.deckTree.subdecks.find((deck) => deck.deckTag === deckTag) || null;
                continue;
            }

            // 合并子卡片到所有父层级
            for (let l = maxLevel - 1; l >= 0; l--) {
                if (!deckLevels[l].prefix) continue;

                const subDecks = SRPlugin.deckTree.subdecks.filter(
                    (deck) => deck.deckTag === deckTag
                );

                if (subDecks.length > 0) {
                    for (const subDeck of subDecks) {
                        deckLevels[l].parentDeck?.newFlashcards.push(...subDeck.newFlashcards);
                        deckLevels[l].parentDeck?.dueFlashcards.push(...subDeck.dueFlashcards);
                    }
                }
            }

            if (deckTag.startsWith("#[[") && !deckTag.contains("|")) {
                await processTagFile(deckTag);
            } else if (deckTag.startsWith("#[[") && deckTag.contains("|")) {
                const parts = deckTag.split("|");
                for (const part of parts) {
                    await processTagFile(part);
                }
            }
        }

        // 最终去重所有层级
        deckLevels.forEach((level) => this.deduplicateDeckCards(level.parentDeck));
    }

    async resetFlashcardTags() {
        let flashcardTags: string[] = [];
        let excludeFlashcardTags: string[] = [];
        const tagLimits: Record<string, number> = {};

        for (const filePath of ["pages/flashcardb.md", "pages/excludeFlashcardTags.md"]) {
            const tmp: TAbstractFile = this.app.vault.getAbstractFileByPath(filePath);
            if (tmp instanceof TFile) {
                const fileText: string = await this.app.vault.read(tmp);
                if (fileText) {
                    const lines = fileText
                        .split(/\n+/)
                        .map((v) => v.trim())
                        .filter((v) => v);
                    excludeFlashcardTags = excludeFlashcardTags.concat(lines);
                    flashcardTags = flashcardTags.concat(lines);
                }
            }
        }

        for (const filePath of ["pages/flashcard.md", "pages/flashcardbyte.md"]) {
            const tmp: TAbstractFile = this.app.vault.getAbstractFileByPath(filePath);
            if (tmp instanceof TFile) {
                const fileText: string = await this.app.vault.read(tmp);
                if (fileText) {
                    const rawLines = fileText
                        .split(/\n+/)
                        .map((v) => v.trim())
                        .filter((v) => v);

                    // 新增处理每行结尾数字的逻辑
                    for (const line of rawLines) {
                        // 使用正则匹配结尾数字
                        const match = line.match(/(.+?)\s+(\d+)$/);
                        if (match) {
                            const tag = match[1];
                            const limit = parseInt(match[2]);
                            flashcardTags.push(tag);
                            tagLimits[tag] = limit; // 存储标签最大数量
                        } else {
                            flashcardTags.push(line);
                        }
                    }
                }
            }
        }
        this.data.settings.tagLimits = tagLimits;
        this.data.settings.flashcardTags = flashcardTags;
        this.data.settings.excludeFlashcardTags = excludeFlashcardTags;

        // await this.savePluginData();
    }

    checkTagIsValid(): boolean {
        const flashcardTags = this.data.settings.flashcardTags;
        for (const tag of flashcardTags) {
            if (tag.startsWith("#") && tag.endsWith("|")) {
                console.log(`Invalid tag: ${tag}`);
                new Notice(`Invalid tag: ${tag}`);
                return false;
            }
        }
        const excludeFlashcardTags = this.data.settings.excludeFlashcardTags;
        for (const tag of excludeFlashcardTags) {
            if (tag.startsWith("#") && tag.endsWith("|")) {
                new Notice(`Invalid tag: ${tag}`);
                console.log(`Invalid tag: ${tag}`);
                return false;
            }
        }

        return true;
    }

    async printNoTag() {
        const noTagDeckList: Deck[] = SRPlugin.deckTree.subdecks.filter(
            (deck) => deck.deckTag === "#no_tag"
        );

        if (noTagDeckList.length === 0) {
            return; // Exit early if no decks match
        }

        const noTagDeck = noTagDeckList[0];
        const tagList: Set<string> = new Set(); // Use Set to ensure unique tags

        for (const card of noTagDeck.newFlashcards) {
            let text = card.cardText;

            // For MultiLineBasic card type, use the 'front' property
            if (card.cardType === CardType.MultiLineBasic) {
                text = card.front;
            }

            // Find all tags using regex `#[[text]]`
            const reg = /#\[\[([^\|\]]+)(?:\|[^\]]*)?\]\]/g; // <- 修改这里
            let match;

            // Extract all matches and add them to the Set
            while ((match = reg.exec(text)) !== null) {
                tagList.add(match[1]); // Use `add` for Set
            }
        }
        for (const card of noTagDeck.dueFlashcards) {
            let text = card.cardText;

            // For MultiLineBasic card type, use the 'front' property
            if (card.cardType === CardType.MultiLineBasic) {
                text = card.front;
            }

            // Find all tags using regex `#[[text]]`
            const reg = /#\[\[([^\|\]]+)(?:\|[^\]]*)?\]\]/g; // <- 修改这里
            let match;

            // Extract all matches and add them to the Set
            while ((match = reg.exec(text)) !== null) {
                tagList.add(match[1]); // Use `add` for Set
            }
        }

        // Convert Set back to Array
        const tagArray: string[] = Array.from(tagList);
        console.log(Array.from(tagArray.map((tag) => `#[[${tag}]]`)).join("\n"));
        // append to flashcard.md
        const flashcardFile: TFile = this.app.vault.getAbstractFileByPath(
            "pages/flashcard.md"
        ) as TFile;
        if (flashcardFile) {
            const fileText: string = await this.app.vault.read(flashcardFile);
            if (fileText) {
                const lines = fileText
                    .split(/\n+/)
                    .map((v) => v.trim())
                    .filter((v) => v);
                const newLines = lines.concat(tagArray.map((tag) => `#[[${tag}]]`));
                this.app.vault.modify(flashcardFile, newLines.join("\n"));
            }
        }
    }

    async saveReviewResponse(note: TFile, response: ReviewResponse): Promise<void> {
        const fileCachedData = this.app.metadataCache.getFileCache(note) || {};
        const frontmatter: FrontMatterCache | Record<string, unknown> =
            fileCachedData.frontmatter || {};

        const tags = getAllTags(fileCachedData) || [];
        if (this.data.settings.noteFoldersToIgnore.some((folder) => note.path.startsWith(folder))) {
            new Notice(t("NOTE_IN_IGNORED_FOLDER"));
            return;
        }

        let shouldIgnore = true;
        for (const tag of tags) {
            if (
                this.data.settings.tagsToReview.some(
                    (tagToReview) => tag === tagToReview || tag.startsWith(tagToReview + "/")
                )
            ) {
                shouldIgnore = false;
                break;
            }
        }

        if (shouldIgnore) {
            new Notice(t("PLEASE_TAG_NOTE"));
            return;
        }

        let fileText: string = await this.app.vault.read(note);
        let ease: number, interval: number, delayBeforeReview: number;
        const now: number = Date.now();
        // new note
        if (
            !(
                Object.prototype.hasOwnProperty.call(frontmatter, "sr-due") &&
                Object.prototype.hasOwnProperty.call(frontmatter, "sr-interval") &&
                Object.prototype.hasOwnProperty.call(frontmatter, "sr-ease")
            )
        ) {
            let linkTotal = 0,
                linkPGTotal = 0,
                totalLinkCount = 0;

            for (const statObj of this.incomingLinks[note.path] || []) {
                const ease: number = this.easeByPath[statObj.sourcePath];
                if (ease) {
                    linkTotal += statObj.linkCount * this.pageranks[statObj.sourcePath] * ease;
                    linkPGTotal += this.pageranks[statObj.sourcePath] * statObj.linkCount;
                    totalLinkCount += statObj.linkCount;
                }
            }

            const outgoingLinks = this.app.metadataCache.resolvedLinks[note.path] || {};
            for (const linkedFilePath in outgoingLinks) {
                const ease: number = this.easeByPath[linkedFilePath];
                if (ease) {
                    linkTotal +=
                        outgoingLinks[linkedFilePath] * this.pageranks[linkedFilePath] * ease;
                    linkPGTotal += this.pageranks[linkedFilePath] * outgoingLinks[linkedFilePath];
                    totalLinkCount += outgoingLinks[linkedFilePath];
                }
            }

            const linkContribution: number =
                this.data.settings.maxLinkFactor *
                Math.min(1.0, Math.log(totalLinkCount + 0.5) / Math.log(64));
            ease =
                (1.0 - linkContribution) * this.data.settings.baseEase +
                (totalLinkCount > 0
                    ? (linkContribution * linkTotal) / linkPGTotal
                    : linkContribution * this.data.settings.baseEase);
            // add note's average flashcard ease if available
            if (Object.prototype.hasOwnProperty.call(this.easeByPath, note.path)) {
                ease = (ease + this.easeByPath[note.path]) / 2;
            }
            ease = Math.round(ease);
            interval = 1.0;
            delayBeforeReview = 0;
        } else {
            interval = frontmatter["sr-interval"];
            ease = frontmatter["sr-ease"];
            delayBeforeReview =
                now -
                window
                    .moment(frontmatter["sr-due"], ["YYYY-MM-DD", "DD-MM-YYYY", "ddd MMM DD YYYY"])
                    .valueOf();
        }

        const schedObj: Record<string, number> = schedule(
            response,
            interval,
            ease,
            delayBeforeReview,
            this.data.settings,
            this.dueDatesNotes
        );
        interval = schedObj.interval;
        ease = schedObj.ease;

        const due = window.moment(now + interval * 24 * 3600 * 1000);
        const dueString: string = due.format("YYYY-MM-DD");

        // check if scheduling info exists
        if (SCHEDULING_INFO_REGEX.test(fileText)) {
            const schedulingInfo = SCHEDULING_INFO_REGEX.exec(fileText);
            fileText = fileText.replace(
                SCHEDULING_INFO_REGEX,
                `---\n${schedulingInfo[1]}sr-due: ${dueString}\n` +
                    `sr-interval: ${interval}\nsr-ease: ${ease}\n` +
                    `${schedulingInfo[5]}---`
            );
        } else if (YAML_FRONT_MATTER_REGEX.test(fileText)) {
            // new note with existing YAML front matter
            const existingYaml = YAML_FRONT_MATTER_REGEX.exec(fileText);
            fileText = fileText.replace(
                YAML_FRONT_MATTER_REGEX,
                `---\n${existingYaml[1]}sr-due: ${dueString}\n` +
                    `sr-interval: ${interval}\nsr-ease: ${ease}\n---`
            );
        } else {
            fileText =
                `---\nsr-due: ${dueString}\nsr-interval: ${interval}\n` +
                `sr-ease: ${ease}\n---\n\n${fileText}`;
        }

        if (this.data.settings.burySiblingCards) {
            await this.findFlashcardsInNote(note, [], true); // bury all cards in current note
            await this.savePluginData();
        }
        await this.app.vault.modify(note, fileText);

        new Notice(t("RESPONSE_RECEIVED"));

        await this.sync();
        if (this.data.settings.autoNextNote) {
            this.reviewNextNote(this.lastSelectedReviewDeck);
        }
    }

    async reviewNextNoteModal(): Promise<void> {
        const reviewDeckNames: string[] = Object.keys(this.reviewDecks);
        if (reviewDeckNames.length === 1) {
            this.reviewNextNote(reviewDeckNames[0]);
        } else {
            const deckSelectionModal = new ReviewDeckSelectionModal(this.app, reviewDeckNames);
            deckSelectionModal.submitCallback = (deckKey: string) => this.reviewNextNote(deckKey);
            deckSelectionModal.open();
        }
    }

    async reviewNextNote(deckKey: string): Promise<void> {
        if (!Object.prototype.hasOwnProperty.call(this.reviewDecks, deckKey)) {
            new Notice(t("NO_DECK_EXISTS", { deckName: deckKey }));
            return;
        }

        this.lastSelectedReviewDeck = deckKey;
        const deck = this.reviewDecks[deckKey];

        if (deck.dueNotesCount > 0) {
            const index = this.data.settings.openRandomNote
                ? Math.floor(Math.random() * deck.dueNotesCount)
                : 0;
            this.app.workspace.activeLeaf.openFile(deck.scheduledNotes[index].note);
            return;
        }

        if (deck.newNotes.length > 0) {
            const index = this.data.settings.openRandomNote
                ? Math.floor(Math.random() * deck.newNotes.length)
                : 0;
            this.app.workspace.activeLeaf.openFile(deck.newNotes[index]);
            return;
        }

        new Notice(t("ALL_CAUGHT_UP"));
    }

    findDeckPath(note: TFile): string[] {
        let deckPath: string[] = [];
        if (this.data.settings.convertFoldersToDecks) {
            deckPath = note.path.split("/");
            deckPath.pop(); // remove filename
            if (deckPath.length === 0) {
                deckPath = ["/"];
            }
        } else {
            const fileCachedData = this.app.metadataCache.getFileCache(note) || {};
            let tags = getAllTags(fileCachedData) || [];
            if (fileCachedData.links) {
                for (const link of fileCachedData.links) {
                    tags.push("#" + link.original);
                }
            }

            outer: for (let tagToReview of this.data.settings.flashcardTags) {
                for (const tag of tags) {
                    if (tag === tagToReview || tag.startsWith(tagToReview + "/")) {
                        deckPath = tag.substring(1).split("/");
                        break outer;
                    }
                }
            }
        }

        return deckPath;
    }

    async findFlashcardsInNote(
        note: TFile,
        deckPath: string[],
        buryOnly = false,
        ignoreStats = false
    ): Promise<number> {
        let fileText: string = await this.app.vault.read(note);
        const fileCachedData = this.app.metadataCache.getFileCache(note) || {};
        const headings: HeadingCache[] = fileCachedData.headings || [];
        let fileChanged = false,
            totalNoteEase = 0,
            scheduledCount = 0;
        const settings: SRSettings = this.data.settings;
        const noteDeckPath = deckPath;
        const multilineRegex = new RegExp(
            `^[\\t ]*${escapeRegex(settings.multilineCardSeparator)}`,
            "gm"
        );
        const multilineRegexEnd = new RegExp(
            `(?<=(^[\\t ]*${escapeRegex(settings.multilineCardSeparator)}))`,
            "gm"
        );
        const multilineRegexReversed = new RegExp(
            `^[\\t ]*${escapeRegex(settings.multilineReversedCardSeparator)}`,
            "gm"
        );
        const multilineRegexReversedEnd = new RegExp(
            `(?<=(^[\\t ]*${escapeRegex(settings.multilineReversedCardSeparator)}))`,
            "gm"
        );

        const now: number = Date.now();
        const tagsSet = new Set([...settings.flashcardTags, ...settings.excludeFlashcardTags]);
        let multiTagsArray: MultiTagsObj[] = this.data.settings.flashcardTags
            .filter((tag) => tag.split("&").length > 1 && !tag.startsWith("|"))
            .map((tag) => {
                return { name: tag, tags: tag.split("&") };
            });

        multiTagsArray = Array.from(
            new Map(multiTagsArray.map((item) => [item.name, item])).values()
        ); // remove duplicate

        let unionTagsArray: MultiTagsObj[] = this.data.settings.flashcardTags
            .filter((tag) => tag.split("|").length > 1 && !tag.startsWith("|"))
            .map((tag) => {
                return { name: tag, tags: tag.split("|") };
            });

        unionTagsArray = Array.from(
            new Map(unionTagsArray.map((item) => [item.name, item])).values()
        ); // remove duplicate

        // tagsSet need to be set, and add multiTagsArray's each tiny part and unionTagsArray's each tiny part to tagsSet
        for (const multiTagsObj of multiTagsArray) {
            for (const tag of multiTagsObj.tags) {
                tagsSet.add(tag);
            }
        }
        for (const unionTagsObj of unionTagsArray) {
            for (const tag of unionTagsObj.tags) {
                tagsSet.add(tag);
            }
        }

        const parsedCards: [CardType, string, number, string[]][] = parse(
            fileText,
            settings.singlelineCardSeparator,
            settings.singlelineReversedCardSeparator,
            settings.multilineCardSeparator,
            settings.multilineReversedCardSeparator,
            settings.convertHighlightsToClozes,
            settings.convertBoldTextToClozes,
            Array.from(tagsSet)
        );
        for (const parsedCard of parsedCards) {
            deckPath = noteDeckPath;
            const cardType: CardType = parsedCard[0],
                lineNo: number = parsedCard[2];
            let cardText: string = parsedCard[1];
            const cardTags: string[] = parsedCard[3];

            if (!settings.convertFoldersToDecks) {
                const tagInCardRegEx = /^#[^\s#]+/gi;
                const cardDeckPath = cardText
                    .match(tagInCardRegEx)
                    ?.slice(-1)[0]
                    .replace("#", "")
                    .split("/");
                if (cardDeckPath) {
                    deckPath = cardDeckPath;
                    cardText = cardText.replaceAll(tagInCardRegEx, "");
                }
            }

            // // SRPlugin.deckTree.createDeck([...deckPath]);
            // for (const carTag of cardTags) {
            //     SRPlugin.deckTree.createDeck([carTag]);
            // }
            // if (cardTags) {
            //     SRPlugin.deckTree.createDeck([cardTags]);
            // }
            if (cardTags.contains(NO_TAG)) {
                SRPlugin.deckTree.createDeck([NO_TAG]);
            }
            const cardTextHash: string = cyrb53(cardText);

            if (buryOnly) {
                this.data.buryList.push(cardTextHash);
                continue;
            }

            const siblingMatches: [string, string][] = [];
            if (cardType === CardType.Cloze) {
                const siblings: RegExpMatchArray[] = [];
                if (settings.convertHighlightsToClozes) {
                    siblings.push(...cardText.matchAll(/==(.*?)==/gm));
                }
                if (settings.convertBoldTextToClozes) {
                    siblings.push(...cardText.matchAll(/\*\*(.*?)\*\*/gm));
                }
                siblings.sort((a, b) => {
                    if (a.index < b.index) {
                        return -1;
                    }
                    if (a.index > b.index) {
                        return 1;
                    }
                    return 0;
                });

                let front: string, back: string;
                for (const m of siblings) {
                    const deletionStart: number = m.index,
                        deletionEnd: number = deletionStart + m[0].length;
                    front =
                        cardText.substring(0, deletionStart) +
                        "<span style='color:#2196f3'>[...]</span>" +
                        cardText.substring(deletionEnd);
                    front = front.replace(/==/gm, "").replace(/\*\*/gm, "");
                    back =
                        cardText.substring(0, deletionStart) +
                        "<span style='color:#2196f3'>" +
                        cardText.substring(deletionStart, deletionEnd) +
                        "</span>" +
                        cardText.substring(deletionEnd);
                    back = back.replace(/==/gm, "").replace(/\*\*/gm, "");
                    siblingMatches.push([front, back]);
                }
            } else {
                let idx: number;
                if (cardType === CardType.SingleLineBasic) {
                    idx = cardText.indexOf(settings.singlelineCardSeparator);
                    siblingMatches.push([
                        cardText.substring(0, idx),
                        cardText.substring(idx + settings.singlelineCardSeparator.length),
                    ]);
                } else if (cardType === CardType.SingleLineReversed) {
                    idx = cardText.indexOf(settings.singlelineReversedCardSeparator);
                    const side1: string = cardText.substring(0, idx),
                        side2: string = cardText.substring(
                            idx + settings.singlelineReversedCardSeparator.length
                        );
                    siblingMatches.push([side2, side1]);
                } else if (cardType === CardType.MultiLineBasic) {
                    idx = cardText.search(multilineRegex) - 1;
                    const answerIdx = cardText.search(multilineRegexEnd);
                    siblingMatches.push([
                        cardText.substring(0, idx),
                        cardText.substring(answerIdx + settings.multilineCardSeparator.length),
                    ]);
                } else if (cardType === CardType.MultiLineReversed) {
                    idx = cardText.search(multilineRegexReversed) - 1;
                    const answerIdx = cardText.search(multilineRegexReversedEnd);
                    const side1: string = cardText.substring(0, idx),
                        side2: string = cardText.substring(
                            answerIdx + settings.multilineReversedCardSeparator.length
                        );
                    siblingMatches.push([side2, side1]);
                }
            }
            let scheduling: RegExpMatchArray[] = [];
            if (cardType === CardType.MultiLineBasic) {
                const multilineRegex = new RegExp(
                    `^[\\t ]*${escapeRegex(settings.multilineCardSeparator)}`,
                    "gm"
                );
                const questionLastIdx = cardText.search(multilineRegex) - 1;
                const question = cardText.substring(0, questionLastIdx);
                scheduling = [...question.matchAll(MULTI_SCHEDULING_EXTRACTOR)];
            } else {
                scheduling = [...cardText.matchAll(MULTI_SCHEDULING_EXTRACTOR)];
                if (scheduling.length === 0)
                    scheduling = [...cardText.matchAll(LEGACY_SCHEDULING_EXTRACTOR)];
            }

            const context: string = settings.showContextInCards
                ? getCardContext(lineNo, headings)
                : "";
            const siblings: Card[] = [];
            for (let i = 0; i < siblingMatches.length; i++) {
                const front: string = siblingMatches[i][0],
                    back: string = siblingMatches[i][1];

                const cardObj: Card = {
                    isDue: i < scheduling.length,
                    note,
                    lineNo,
                    front,
                    back,
                    cardText,
                    context,
                    cardType,
                    siblingIdx: i,
                    siblings,
                };

                // card scheduled
                if (ignoreStats) {
                    this.cardStats.newCount++;
                    cardObj.isDue = true;
                    for (const cardTag of cardTags) {
                        if (cardTag) {
                            SRPlugin.deckTree.insertFlashcard([cardTag], cardObj);
                        } else {
                            SRPlugin.deckTree.insertFlashcard([...deckPath], cardObj);
                        }
                    }
                } else if (i < scheduling.length) {
                    const dueUnix: number = window
                        .moment(scheduling[i][1], ["YYYY-MM-DD", "DD-MM-YYYY"])
                        .valueOf();
                    const nDays: number = Math.ceil((dueUnix - now) / (24 * 3600 * 1000));
                    if (!Object.prototype.hasOwnProperty.call(this.dueDatesFlashcards, nDays)) {
                        this.dueDatesFlashcards[nDays] = 0;
                    }
                    this.dueDatesFlashcards[nDays]++;

                    const interval: number = parseInt(scheduling[i][2]),
                        ease: number = parseInt(scheduling[i][3]);
                    if (!Object.prototype.hasOwnProperty.call(this.cardStats.intervals, interval)) {
                        this.cardStats.intervals[interval] = 0;
                    }
                    this.cardStats.intervals[interval]++;
                    if (!Object.prototype.hasOwnProperty.call(this.cardStats.eases, ease)) {
                        this.cardStats.eases[ease] = 0;
                    }
                    this.cardStats.eases[ease]++;
                    totalNoteEase += ease;
                    scheduledCount++;

                    if (interval >= 32) {
                        this.cardStats.matureCount++;
                    } else {
                        this.cardStats.youngCount++;
                    }

                    if (this.data.buryList.includes(cardTextHash)) {
                        SRPlugin.deckTree.countFlashcard([...deckPath]);
                        continue;
                    }

                    if (dueUnix <= now) {
                        cardObj.interval = interval;
                        cardObj.ease = ease;
                        cardObj.delayBeforeReview = now - dueUnix;
                        for (const cardTag of cardTags) {
                            if (cardTag) {
                                SRPlugin.deckTree.insertFlashcard([cardTag], cardObj);
                            } else {
                                SRPlugin.deckTree.insertFlashcard([...deckPath], cardObj);
                            }
                        }
                        for (const multiTag of multiTagsArray) {
                            // cardTags include all multiTag.tags
                            if (multiTag.tags.every((tag) => cardTags.includes(tag))) {
                                SRPlugin.deckTree.insertFlashcard([multiTag.name], cardObj);
                            }
                        }
                        for (const unionTag of unionTagsArray) {
                            // 检查当前卡片标签是否包含任意联合标签的标签
                            if (unionTag.tags.some((tag) => cardTags.includes(tag))) {
                                // 如果包含，则将卡片插入到联合标签的名称中
                                SRPlugin.deckTree.insertFlashcard([unionTag.name], cardObj);
                            }
                        }
                    } else {
                        SRPlugin.deckTree.countFlashcard([...deckPath]);
                        continue;
                    }
                } else {
                    this.cardStats.newCount++;
                    if (this.data.buryList.includes(cyrb53(cardText))) {
                        SRPlugin.deckTree.countFlashcard([...deckPath]);
                        continue;
                    }
                    for (const cardTag of cardTags) {
                        if (cardTag) {
                            SRPlugin.deckTree.insertFlashcard([cardTag], cardObj);
                        } else {
                            SRPlugin.deckTree.insertFlashcard([...deckPath], cardObj);
                        }
                    }
                    for (const multiTag of multiTagsArray) {
                        // cardTags include all multiTag.tags
                        if (multiTag.tags.every((tag) => cardTags.includes(tag))) {
                            SRPlugin.deckTree.insertFlashcard([multiTag.name], cardObj);
                        }
                    }
                    for (const unionTag of unionTagsArray) {
                        // 检查当前卡片标签是否包含任意联合标签的标签
                        if (unionTag.tags.some((tag) => cardTags.includes(tag))) {
                            // 如果包含，则将卡片插入到联合标签的名称中
                            SRPlugin.deckTree.insertFlashcard([unionTag.name], cardObj);
                        }
                    }
                }

                siblings.push(cardObj);
            }
        }

        if (fileChanged) {
            await this.app.vault.modify(note, fileText);
        }

        if (scheduledCount > 0) {
            const flashcardsInNoteAvgEase: number = totalNoteEase / scheduledCount;
            const flashcardContribution: number = Math.min(
                1.0,
                Math.log(scheduledCount + 0.5) / Math.log(64)
            );
            return (
                flashcardsInNoteAvgEase * flashcardContribution +
                settings.baseEase * (1.0 - flashcardContribution)
            );
        }

        return 0;
    }

    async loadPluginData(): Promise<void> {
        const savedData = await this.loadData();
        this.data = Object.assign({}, DEFAULT_DATA, savedData);
        this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings);
        // 修改为从本地文件读取缓存
        const cachePath = `${this.app.vault.configDir}/plugins/obsidian-spaced-repetition/cache.json`;
        try {
            this.cacheDeckString = await this.app.vault.adapter.read(cachePath);
        } catch (e) {
            this.cacheDeckString = "";
        }
    }

    public async savePluginData(): Promise<void> {
        const cleanSettings: SRSettings = {
            tagLimits: this.data.settings.tagLimits,
            flashcardTags: this.data.settings.flashcardTags,
            profit: this.data.settings.profit,
            excludeFlashcardTags: this.data.settings.excludeFlashcardTags,
            convertFoldersToDecks: this.data.settings.convertFoldersToDecks,
            cardCommentOnSameLine: this.data.settings.cardCommentOnSameLine,
            burySiblingCards: this.data.settings.burySiblingCards,
            showContextInCards: this.data.settings.showContextInCards,
            flashcardHeightPercentage: this.data.settings.flashcardHeightPercentage,
            flashcardWidthPercentage: this.data.settings.flashcardWidthPercentage,
            showFileNameInFileLink: this.data.settings.showFileNameInFileLink,
            randomizeCardOrder: this.data.settings.randomizeCardOrder,
            convertHighlightsToClozes: this.data.settings.convertHighlightsToClozes,
            convertBoldTextToClozes: this.data.settings.convertBoldTextToClozes,
            singlelineCardSeparator: this.data.settings.singlelineCardSeparator,
            singlelineReversedCardSeparator: this.data.settings.singlelineReversedCardSeparator,
            multilineCardSeparator: this.data.settings.multilineCardSeparator,
            lastSyncDate: this.data.settings.lastSyncDate,
            multilineReversedCardSeparator: this.data.settings.multilineReversedCardSeparator,
            tagsToReview: this.data.settings.tagsToReview,
            noteFoldersToIgnore: this.data.settings.noteFoldersToIgnore,
            openRandomNote: this.data.settings.openRandomNote,
            autoNextNote: this.data.settings.autoNextNote,
            disableFileMenuReviewOptions: this.data.settings.disableFileMenuReviewOptions,
            maxNDaysNotesReviewQueue: this.data.settings.maxNDaysNotesReviewQueue,
            baseEase: this.data.settings.baseEase,
            lapsesIntervalChange: this.data.settings.lapsesIntervalChange,
            easyBonus: this.data.settings.easyBonus,
            maximumInterval: this.data.settings.maximumInterval,
            maxLinkFactor: this.data.settings.maxLinkFactor,
            showDebugMessages: this.data.settings.showDebugMessages,
        };

        const cleanData: PluginData = {
            settings: cleanSettings,
            buryDate: this.data.buryDate,
            buryList: this.data.buryList,
            historyDeck: this.data.historyDeck,
        };
        await this.saveData(cleanData);
        const cachePath = `${this.app.vault.configDir}/plugins/obsidian-spaced-repetition/cache.json`;
        await this.app.vault.adapter.write(cachePath, this.cacheDeckString);
    }

    initView(): void {
        if (this.app.workspace.getLeavesOfType(REVIEW_QUEUE_VIEW_TYPE).length) {
            return;
        }

        this.app.workspace.getRightLeaf(false).setViewState({
            type: REVIEW_QUEUE_VIEW_TYPE,
            active: true,
        });
    }
}

function getCardContext(cardLine: number, headings: HeadingCache[]): string {
    const stack: HeadingCache[] = [];
    for (const heading of headings) {
        if (heading.position.start.line > cardLine) {
            break;
        }

        while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
            stack.pop();
        }

        stack.push(heading);
    }

    let context = "";
    for (const headingObj of stack) {
        headingObj.heading = headingObj.heading.replace(/\[\^\d+\]/gm, "").trim();
        context += headingObj.heading + " > ";
    }
    return context.slice(0, -3);
}

// 新增接口定义
interface DeckLevel {
    prefix: string;
    parentDeck: Deck | null;
}
