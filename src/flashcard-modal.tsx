import {
    Modal,
    App,
    MarkdownRenderer,
    Notice,
    Platform,
    TFile,
    MarkdownView,
    WorkspaceLeaf,
} from "obsidian";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import h from "vhtml";

import SRPlugin from "src/main";
import { Card, CardType, schedule, textInterval, ReviewResponse, cardToJSON } from "src/scheduling";
import {
    COLLAPSE_ICON,
    MULTI_SCHEDULING_EXTRACTOR,
    LEGACY_SCHEDULING_EXTRACTOR,
    IMAGE_FORMATS,
    AUDIO_FORMATS,
    VIDEO_FORMATS,
} from "src/constants";
import { escapeRegexString, cyrb53 } from "src/utils";
import { t } from "src/lang/helpers";
import { escapeRegex } from "./parser";

import { applySettingsUpdate } from "src/settings";

import { default as sortable } from "html5sortable/dist/html5sortable.es.js";
import { start } from "repl";

export enum FlashcardModalMode {
    DecksList,
    Front,
    Back,
    Closed,
}

export class FlashcardModal extends Modal {
    public plugin: SRPlugin;
    public answerBtn: HTMLElement;
    public flashcardView: HTMLElement;
    public hardBtn: HTMLElement;
    public skipBtn: HTMLElement;
    public goodBtn: HTMLElement;
    public easyBtn: HTMLElement;
    public nextBtn: HTMLElement;
    public responseDiv: HTMLElement;
    public fileLinkView: HTMLElement;
    public resetLinkView: HTMLElement;
    public contextView: HTMLElement;
    public currentCard: Card;
    public currentCardIdx: number;
    public currentDeck: Deck;
    public checkDeck: Deck;
    public mode: FlashcardModalMode;
    public ignoreStats: boolean;
    public progressContainer: HTMLElement;
    public progressBar: HTMLElement;
    public progressText: HTMLElement;

    constructor(app: App, plugin: SRPlugin, ignoreStats = false) {
        super(app);

        this.plugin = plugin;
        this.ignoreStats = ignoreStats;

        this.titleEl.setText(t("DECKS"));

        if (Platform.isMobile) {
            this.contentEl.style.display = "block";
        }
        this.modalEl.style.height = this.plugin.data.settings.flashcardHeightPercentage + "%";
        this.modalEl.style.width = this.plugin.data.settings.flashcardWidthPercentage + "%";

        this.contentEl.style.position = "relative";
        this.contentEl.style.height = "92%";
        this.contentEl.addClass("sr-modal-content");

        document.body.onkeydown = (e) => {
            if (this.mode !== FlashcardModalMode.DecksList) {
                if (this.mode !== FlashcardModalMode.Closed && e.code === "KeyS") {
                    this.currentDeck.deleteFlashcardAtIndex(
                        this.currentCardIdx,
                        this.currentCard.isDue
                    );
                    this.burySiblingCards(false);
                    this.currentDeck.nextCard(this);
                } else if (
                    this.mode === FlashcardModalMode.Front &&
                    (e.code === "Space" || e.code === "Enter")
                ) {
                    this.showAnswer();
                } else if (this.mode === FlashcardModalMode.Back) {
                    if (e.code === "Numpad1" || e.code === "Digit1") {
                        this.processReview(ReviewResponse.Hard);
                    } else if (e.code === "Numpad2" || e.code === "Digit2" || e.code === "Space") {
                        this.processReview(ReviewResponse.Good);
                    } else if (e.code === "Numpad3" || e.code === "Digit3") {
                        this.processReview(ReviewResponse.Easy);
                    } else if (e.code === "Numpad4" || e.code === "Digit4") {
                        this.processReview(ReviewResponse.Reset);
                    } else if (e.code === "Numpad5" || e.code === "Digit5") {
                        this.processReview(ReviewResponse.Skip);
                    }
                }
            }
        };
    }

    private static initialized: boolean = false;

    onOpen(): void {
        // if (Platform.isMobile && 1) {
        //     if (!FlashcardModal.initialized) {
        //         this.plugin.data.historyDeck = "";
        //         FlashcardModal.initialized = true;
        //     }
        // }
        this.decksList();
    }

    onClose(): void {
        this.mode = FlashcardModalMode.Closed;
    }

    public static lastTimeDeck: Deck = null;

    decksList(): void {
        const aimDeck = SRPlugin.deckTree.subdecks.filter(
            (deck) => deck.deckTag === this.plugin.data.historyDeck
        );
        if (this.plugin.data.historyDeck && aimDeck.length > 0) {
            const deck = aimDeck[0];
            // if (Platform.isMobile && 1) {
            //     if (FlashcardModal.lastTimeDeck) {
            //         deck = FlashcardModal.lastTimeDeck;
            //     }
            // }

            this.currentDeck = deck;
            this.checkDeck = deck.parent;
            this.setupCardsView();
            deck.nextCard(this);
            // if (Platform.isMobile && 1) {
            //     if (SRPlugin.deckTree.subdecks.length > 1) {
            //         // // clear all the other useless deck
            //         // SRPlugin.deckTree.subdecks = [deck];
            //         FlashcardModal.lastTimeDeck = deck;
            //     }
            // }
            return;
        }

        this.mode = FlashcardModalMode.DecksList;
        this.titleEl.setText(t("DECKS"));
        this.contentEl.innerHTML = "";
        this.contentEl.setAttribute("id", "sr-flashcard-view");

        const sidebarEl = this.contentEl.createDiv("sidebar");
        sidebarEl.setAttribute("id", "title-sidebar");

        const mainContentEl = this.contentEl.createDiv("main-content");
        for (const deck of SRPlugin.deckTree.subdecks) {
            if (this.plugin.data.settings.excludeFlashcardTags.length > 0) {
                if (this.plugin.data.settings.excludeFlashcardTags.includes(deck.deckTag)) {
                    continue;
                }
            }
            deck.render(mainContentEl, this);

            // If the deckTag matches the title pattern, add it to the sidebar
            if (/^\|\|.+\|\|$/.test(deck.deckTag)) {
                // Handle ||title|| case - Larger title
                const titleItem = sidebarEl.createDiv("sidebar-item sidebar-item-large");
                titleItem.innerText = deck.deckTag.replace(/\|\|/g, ""); // Remove '||' characters for display
                titleItem.addEventListener("click", () => {
                    // Scroll to the corresponding deck in the main content
                    const targetDeckEl = mainContentEl.querySelector(
                        `[data-deck-tag="${deck.deckTag}"]`
                    );
                    if (targetDeckEl) {
                        targetDeckEl.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                });
            } else if (/^\|.+\|$/.test(deck.deckTag)) {
                // Handle |title| case - Smaller title
                const titleItem = sidebarEl.createDiv("sidebar-item sidebar-item-small");
                titleItem.innerText = deck.deckTag.replace(/\|/g, ""); // Remove '|' characters for display
                titleItem.addEventListener("click", () => {
                    // Scroll to the corresponding deck in the main content
                    const targetDeckEl = mainContentEl.querySelector(
                        `[data-deck-tag="${deck.deckTag}"]`
                    );
                    if (targetDeckEl) {
                        targetDeckEl.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                });
            }
        }
    }

    setupCardsView(): void {
        this.contentEl.innerHTML = "";
        this.contentEl.setAttribute("id", "sr-flashcard-view-qa");
        const historyLinkView = this.contentEl.createEl("button");
        historyLinkView.setAttribute("id", "sr-history-link");
        historyLinkView.setText("〈");
        historyLinkView.addEventListener("click", (e: PointerEvent) => {
            if (e.pointerType.length > 0) {
                this.plugin.data.historyDeck = "";
                this.decksList();
            }
        });

        this.fileLinkView = this.contentEl.createDiv("sr-link");
        this.fileLinkView.setText(t("EDIT_LATER"));
        if (this.plugin.data.settings.showFileNameInFileLink) {
            this.fileLinkView.setAttribute("aria-label", t("EDIT_LATER"));
        }
        this.fileLinkView.addEventListener("click", async () => {
            const activeLeaf: WorkspaceLeaf = this.plugin.app.workspace.activeLeaf;
            // const n = {
            //     "match": {
            //         "content": "Card1 #p ;;     <!--SR:!2022-07-16,3,250-->\nCard2 #p ;; #[[dLove]]\n\n",
            //         "matches": [
            //             [
            //                 57,
            //                 66
            //             ]
            //         ]
            //     }
            // };
            const fileText: string = await this.app.vault.read(this.currentCard.note);
            //find start index of card
            const startIndex = fileText.search(escapeRegex(this.currentCard.cardText));
            if (startIndex != -1) {
                const n = {
                    match: {
                        content: fileText,
                        matches: [[startIndex, startIndex + this.currentCard.cardText.length]],
                    },
                };
                activeLeaf.openFile(this.currentCard.note, {
                    active: true,
                    eState: n,
                });
            } else {
                await activeLeaf.openFile(this.currentCard.note);
                const activeView: MarkdownView =
                    this.app.workspace.getActiveViewOfType(MarkdownView);
                activeView.editor.setCursor({
                    line: this.currentCard.lineNo,
                    ch: 0,
                });
                activeView.editor.scrollTo(this.currentCard.lineNo, 0);
            }
        });

        this.resetLinkView = this.contentEl.createDiv("sr-link");
        this.resetLinkView.setText(t("RESET_CARD_PROGRESS"));
        this.resetLinkView.addEventListener("click", () => {
            this.processReview(ReviewResponse.Reset);
        });
        this.resetLinkView.style.float = "right";
        // Create the Progress Bar
        this.progressContainer = this.contentEl.createDiv("sr-progress-container");

        // Add Progress Track
        const progressTrack = this.progressContainer.createDiv("sr-progress-track");

        // Add Progress Bar inside the Track
        this.progressBar = progressTrack.createDiv("sr-progress-bar");

        // Add Progress Text
        this.progressText = this.progressContainer.createSpan("sr-progress-text");

        if (this.plugin.data.settings.showContextInCards) {
            this.contextView = this.contentEl.createDiv();
            this.contextView.setAttribute("id", "sr-context");
        }

        this.flashcardView = this.contentEl.createDiv("div");
        this.flashcardView.setAttribute("id", "sr-flashcard-view-qa");

        this.responseDiv = this.contentEl.createDiv("sr-response");

        this.hardBtn = document.createElement("button");
        this.hardBtn.setAttribute("id", "sr-hard-btn");
        this.hardBtn.setText(t("HARD"));
        this.hardBtn.addEventListener("click", () => {
            this.processReview(ReviewResponse.Hard);
        });
        this.responseDiv.appendChild(this.hardBtn);

        this.goodBtn = document.createElement("button");
        this.goodBtn.setAttribute("id", "sr-good-btn");
        this.goodBtn.setText(t("GOOD"));
        this.goodBtn.addEventListener("click", () => {
            this.processReview(ReviewResponse.Good);
        });
        this.responseDiv.appendChild(this.goodBtn);

        this.easyBtn = document.createElement("button");
        this.easyBtn.setAttribute("id", "sr-easy-btn");
        this.easyBtn.setText(t("EASY"));
        this.easyBtn.addEventListener("click", () => {
            this.processReview(ReviewResponse.Easy);
        });
        this.responseDiv.appendChild(this.easyBtn);

        this.skipBtn = document.createElement("button");
        this.skipBtn.setAttribute("id", "sr-skip-btn");
        this.skipBtn.setText(t("SKIP"));
        this.skipBtn.addEventListener("click", () => {
            this.processReview(ReviewResponse.Skip);
        });
        this.responseDiv.appendChild(this.skipBtn);
        this.responseDiv.style.display = "none";

        this.answerBtn = this.contentEl.createDiv();
        this.answerBtn.setAttribute("id", "sr-show-answer");
        this.answerBtn.setText(t("SHOW_ANSWER"));
        this.answerBtn.addEventListener("click", () => {
            this.showAnswer();
        });

        if (this.ignoreStats) {
            this.goodBtn.style.display = "none";

            this.responseDiv.addClass("sr-ignorestats-response");
            this.easyBtn.addClass("sr-ignorestats-btn");
            this.hardBtn.addClass("sr-ignorestats-btn");
            this.skipBtn.addClass("sr-ignorestats-btn");
        }
    }

    showAnswer(): void {
        this.mode = FlashcardModalMode.Back;

        this.answerBtn.style.display = "none";
        this.responseDiv.style.display = "grid";

        if (this.currentCard.isDue) {
            this.resetLinkView.style.display = "inline-block";
        }

        if (this.currentCard.cardType !== CardType.Cloze) {
            const hr: HTMLElement = document.createElement("hr");
            hr.setAttribute("id", "sr-hr-card-divide");
            this.flashcardView.appendChild(hr);
        } else {
            this.flashcardView.innerHTML = "";
        }

        this.renderMarkdownWrapper("- A:\n" + this.currentCard.back, this.flashcardView);
    }

    async processReview(response: ReviewResponse): Promise<void> {
        if (this.ignoreStats) {
            if (response == ReviewResponse.Easy) {
                this.currentDeck.deleteFlashcardAtIndex(
                    this.currentCardIdx,
                    this.currentCard.isDue
                );
            }
            this.currentDeck.nextCard(this);
            return;
        }

        let interval: number, ease: number, due;

        this.currentDeck.deleteFlashcardAtIndex(this.currentCardIdx, this.currentCard.isDue);
        if (response !== ReviewResponse.Reset && response !== ReviewResponse.Skip) {
            let schedObj: Record<string, number>;
            // scheduled card
            if (this.currentCard.isDue) {
                schedObj = schedule(
                    response,
                    this.currentCard.interval,
                    this.currentCard.ease,
                    this.currentCard.delayBeforeReview,
                    this.plugin.data.settings,
                    this.plugin.dueDatesFlashcards
                );
            } else {
                let initial_ease: number = this.plugin.data.settings.baseEase;
                if (
                    Object.prototype.hasOwnProperty.call(
                        this.plugin.easeByPath,
                        this.currentCard.note.path
                    )
                ) {
                    initial_ease = Math.round(this.plugin.easeByPath[this.currentCard.note.path]);
                }

                schedObj = schedule(
                    response,
                    1.0,
                    initial_ease,
                    0,
                    this.plugin.data.settings,
                    this.plugin.dueDatesFlashcards
                );
                interval = schedObj.interval;
                ease = schedObj.ease;
            }

            interval = schedObj.interval;
            ease = schedObj.ease;
            due = window.moment(Date.now() + interval * 24 * 3600 * 1000);
        } else if (response === ReviewResponse.Reset) {
            const schedObj: Record<string, number> = schedule(
                ReviewResponse.Hard,
                1.0,
                this.plugin.data.settings.baseEase,
                0,
                this.plugin.data.settings,
                this.plugin.dueDatesFlashcards
            );

            interval = schedObj.interval;
            ease = schedObj.ease;
            due = window.moment(Date.now() + interval * 24 * 3600 * 1000);
            // new Notice(t("CARD_PROGRESS_RESET"));
        } else if (response === ReviewResponse.Skip) {
            this.nextCard();
            return;
        }

        const dueString: string = due.format("YYYY-MM-DD");

        let fileText: string = await this.app.vault.read(this.currentCard.note);
        const replacementRegex = new RegExp(escapeRegexString(this.currentCard.cardText), "gm");
        const originalText = this.currentCard.cardText;

        const sep: string = this.plugin.data.settings.cardCommentOnSameLine ? " " : "\n";
        // // Override separator if last block is a codeblock
        // if (this.currentCard.cardText.endsWith("```") && sep !== "\n") {
        //     sep = "\n";
        // }

        // check if we're adding scheduling information to the flashcard
        // for the first time
        if (this.currentCard.cardType === CardType.MultiLineBasic) {
            const multilineRegex = new RegExp(
                `^[\\t ]*${escapeRegex(this.plugin.data.settings.multilineCardSeparator)}`,
                "gm"
            );
            const questionLastIdx = this.currentCard.cardText.search(multilineRegex) - 1;
            const question = this.currentCard.cardText.substring(0, questionLastIdx);
            const originQuestion = question;
            let questionNew = question;
            if (question.indexOf("<!--SR:") === -1) {
                questionNew = question + sep + `<!--SR:!${dueString},${interval},${ease}-->`;
                this.currentCard.cardText = this.currentCard.cardText.replace(
                    question,
                    questionNew
                );
            } else {
                const questionWithoutSchedule = question.replace(/<!--SR:.+-->/gm, "");
                questionNew =
                    questionWithoutSchedule + sep + `<!--SR:!${dueString},${interval},${ease}-->`;
                this.currentCard.cardText = this.currentCard.cardText.replace(
                    question,
                    questionNew
                );
            }
            if (fileText.contains(originQuestion + "\n")) {
                fileText = fileText.replace(
                    new RegExp(escapeRegexString(question)),
                    () => questionNew
                );
            }
        } else {
            if (this.currentCard.cardText.indexOf("<!--SR:") === -1) {
                this.currentCard.cardText =
                    this.currentCard.cardText + sep + `<!--SR:!${dueString},${interval},${ease}-->`;
            } else {
                let scheduling: RegExpMatchArray[] = [
                    ...this.currentCard.cardText.matchAll(MULTI_SCHEDULING_EXTRACTOR),
                ];
                if (scheduling.length === 0) {
                    scheduling = [
                        ...this.currentCard.cardText.matchAll(LEGACY_SCHEDULING_EXTRACTOR),
                    ];
                }

                const currCardSched: RegExpMatchArray = [
                    "0",
                    dueString,
                    interval.toString(),
                    ease.toString(),
                ] as RegExpMatchArray;
                if (this.currentCard.isDue) {
                    scheduling[this.currentCard.siblingIdx] = currCardSched;
                } else {
                    scheduling.push(currCardSched);
                }

                this.currentCard.cardText = this.currentCard.cardText.replace(/<!--SR:.+-->/gm, "");
                this.currentCard.cardText += "<!--SR:";
                for (let i = 0; i < scheduling.length; i++) {
                    this.currentCard.cardText += `!${scheduling[i][1]},${scheduling[i][2]},${scheduling[i][3]}`;
                }
                this.currentCard.cardText += "-->";
            }
            if (fileText.contains(originalText + "\n")) {
                fileText = fileText.replace(replacementRegex, () => this.currentCard.cardText);
            } else if (fileText.endsWith(originalText)) {
                fileText = fileText.replace(replacementRegex, () => this.currentCard.cardText);
            }
        }
        for (const sibling of this.currentCard.siblings) {
            sibling.cardText = this.currentCard.cardText;
        }
        if (this.plugin.data.settings.burySiblingCards) {
            this.burySiblingCards(true);
        }

        this.app.vault.modify(this.currentCard.note, fileText);
        // random score
        this.ding("Good Job" + " " + 0.3);

        this.nextCard();
    }

    private async ding(name: string) {
        const parts = name.trim().split(/\s+/);
        const lastPart = parts.reverse().find((part) => !isNaN(parseFloat(part)));

        const input = lastPart ? parseFloat(lastPart) : 0;
        const settings = this.plugin.data.settings;
        const value = settings.profit || 0;

        if (input > 0) {
            const triple = this.scaleInteger(input);
            let star = "";
            for (let i = 0; i < triple[1]; i++) {
                star += "*";
            }
            if (triple[1] > 0) {
                new Notice(` ${triple[0].toFixed(8)}% \n ${star}   ${triple[2]} points`);
                console.log(`chance: ${triple[0].toFixed(2)} of ${triple[1]}X : ${triple[2]}`);
                settings.profit = value + triple[2];
                this.plugin.statusBar.setText(`profit: ${settings.profit}`);
            }
        } else {
            new Notice(`diminish : ${input}`);
            settings.profit = value + input;
        }
        await this.plugin.saveData(settings);
    }

    private scaleInteger(input: number): [number, number, number] {
        const randomValue = Math.random();
        const factorsAndMultipliers = [
            [1000000, 0],
            // [120000, 1],
            // [60000, 2],
            [320000, 4],
            [32000, 8],
            [16000, 10],
            [4000, 20],
            [2000, 30],
            [1600, 50],
            [800, 100],
            [400, 200],
            [200, 400],
            [100, 800],
            [64, 1600],
            [32, 3200],
            [16, 6300],
            [8, 10000],
            [4, 50000],
            [2, 100000],
            [1, 1000000],
        ];

        const scaleFactorSum = factorsAndMultipliers.reduce((a, b) => a + b[0], 0);

        let cumulativeProbability = 0.0;
        for (let [scaleFactor, multiplier] of factorsAndMultipliers) {
            const scaleFactorPercentage = scaleFactor / scaleFactorSum;
            cumulativeProbability += scaleFactorPercentage;
            if (randomValue < cumulativeProbability) {
                return [scaleFactorPercentage, multiplier, input * multiplier];
            }
        }

        // If we get here, return the last pair
        const [scaleFactor, multiplier] = factorsAndMultipliers[factorsAndMultipliers.length - 1];
        return [scaleFactor / scaleFactorSum, multiplier, input * multiplier];
    }

    nextCard(): void {
        // refresh cache
        const cacheDeckString = JSON.stringify(SRPlugin.deckTree.toJSON());
        this.plugin.data.settings.cacheDeckString = cacheDeckString;
        this.plugin.savePluginData();
        this.currentDeck.nextCard(this);
    }

    async burySiblingCards(tillNextDay: boolean): Promise<void> {
        if (tillNextDay) {
            this.plugin.data.buryList.push(cyrb53(this.currentCard.cardText));
            await this.plugin.savePluginData();
        }

        for (const sibling of this.currentCard.siblings) {
            const dueIdx = this.currentDeck.dueFlashcards.indexOf(sibling);
            const newIdx = this.currentDeck.newFlashcards.indexOf(sibling);

            if (dueIdx !== -1) {
                this.currentDeck.deleteFlashcardAtIndex(
                    dueIdx,
                    this.currentDeck.dueFlashcards[dueIdx].isDue
                );
            } else if (newIdx !== -1) {
                this.currentDeck.deleteFlashcardAtIndex(
                    newIdx,
                    this.currentDeck.newFlashcards[newIdx].isDue
                );
            }
        }
    }

    // slightly modified version of the renderMarkdown function in
    // https://github.com/mgmeyers/obsidian-kanban/blob/main/src/KanbanView.tsx
    async renderMarkdownWrapper(
        markdownString: string,
        containerEl: HTMLElement,
        recursiveDepth = 0
    ): Promise<void> {
        if (recursiveDepth > 4) return;

        MarkdownRenderer.renderMarkdown(
            markdownString,
            containerEl,
            this.currentCard.note.path,
            this.plugin
        );

        containerEl.findAll(".internal-embed").forEach((el) => {
            const link = this.parseLink(el.getAttribute("src"));

            // file does not exist, display dead link
            if (!link.target) {
                el.innerText = link.text;
            } else if (link.target instanceof TFile) {
                if (link.target.extension !== "md") {
                    this.embedMediaFile(el, link.target);
                } else {
                    el.innerText = "";
                    this.renderTransclude(el, link, recursiveDepth);
                }
            }
        });
    }

    parseLink(src: string) {
        const linkComponentsRegex =
            /^(?<file>[^#^]+)?(?:#(?!\^)(?<heading>.+)|#\^(?<blockId>.+)|#)?$/;
        const matched = typeof src === "string" && src.match(linkComponentsRegex);
        const file = matched.groups.file || this.currentCard.note.path;
        const target = this.plugin.app.metadataCache.getFirstLinkpathDest(
            file,
            this.currentCard.note.path
        );
        // move lookup upstream? ^^^
        return {
            text: matched[0],
            file: matched.groups.file,
            heading: matched.groups.heading,
            blockId: matched.groups.blockId,
            target: target,
        };
    }

    embedMediaFile(el: HTMLElement, target: TFile) {
        el.innerText = "";
        if (IMAGE_FORMATS.includes(target.extension)) {
            el.createEl(
                "img",
                {
                    attr: {
                        src: this.plugin.app.vault.getResourcePath(target),
                    },
                },
                (img) => {
                    if (el.hasAttribute("width"))
                        img.setAttribute("width", el.getAttribute("width"));
                    else img.setAttribute("width", "100%");
                    if (el.hasAttribute("alt")) img.setAttribute("alt", el.getAttribute("alt"));
                    el.addEventListener(
                        "click",
                        (ev) =>
                            ((ev.target as HTMLElement).style.minWidth =
                                (ev.target as HTMLElement).style.minWidth === "100%"
                                    ? null
                                    : "100%")
                    );
                }
            );
            el.addClasses(["image-embed", "is-loaded"]);
        } else if (
            AUDIO_FORMATS.includes(target.extension) ||
            VIDEO_FORMATS.includes(target.extension)
        ) {
            el.createEl(
                AUDIO_FORMATS.includes(target.extension) ? "audio" : "video",
                {
                    attr: {
                        controls: "",
                        src: this.plugin.app.vault.getResourcePath(target),
                    },
                },
                (audio) => {
                    if (el.hasAttribute("alt")) audio.setAttribute("alt", el.getAttribute("alt"));
                }
            );
            el.addClasses(["media-embed", "is-loaded"]);
        } else {
            el.innerText = target.path;
        }
    }

    async renderTransclude(
        el: HTMLElement,
        link: {
            text: string;
            file: string;
            heading: string;
            blockId: string;
            target: TFile;
        },
        recursiveDepth: number
    ) {
        const cache = this.app.metadataCache.getCache(link.target.path);
        const text = await this.app.vault.cachedRead(link.target);
        let blockText;
        if (link.heading) {
            const clean = (s: string) => s.replace(/[\W\s]/g, "");
            const headingIndex = cache.headings?.findIndex(
                (h) => clean(h.heading) === clean(link.heading)
            );
            const heading = cache.headings[headingIndex];

            const startAt = heading.position.start.offset;
            const endAt =
                cache.headings.slice(headingIndex + 1).find((h) => h.level <= heading.level)
                    ?.position?.start?.offset || text.length;

            blockText = text.substring(startAt, endAt);
        } else if (link.blockId) {
            const block = cache.blocks[link.blockId];
            const startAt = block.position.start.offset;
            const endAt = block.position.end.offset;
            blockText = text.substring(startAt, endAt);
        } else {
            blockText = text;
        }

        this.renderMarkdownWrapper(blockText, el, recursiveDepth + 1);
    }
}

export class Deck {
    public deckTag: string;
    public newFlashcards: Card[];
    public newFlashcardsCount = 0; // counts those in subdecks too
    public dueFlashcards: Card[];
    public dueFlashcardsCount = 0; // counts those in subdecks too
    public totalFlashcards = 0; // counts those in subdecks too
    public subdecks: Deck[];
    public originCount = 0;
    public parent: Deck | null;

    toJSON(): Record<string, any> {
        let dueFlashcardsJSON = [];
        let newFlashcardsJSON = [];
        for (let i = 0; i < this.newFlashcards.length; i++) {
            let card = cardToJSON(this.newFlashcards[i]);
            if (card !== undefined) {
                newFlashcardsJSON.push(card);
            }
        }
        for (let i = 0; i < this.dueFlashcards.length; i++) {
            let card = cardToJSON(this.dueFlashcards[i]);
            if (card !== undefined) {
                dueFlashcardsJSON.push(card);
            }
        }
        let subdecksJSON = [];
        for (let i = 0; i < this.subdecks.length; i++) {
            let subdeck = this.subdecks[i].toJSON();
            if (subdeck !== undefined) {
                subdecksJSON.push(subdeck);
            }
        }
        return {
            deckTag: this.deckTag,
            newFlashcards: newFlashcardsJSON,
            newFlashcardsCount: newFlashcardsJSON.length, // Updated line
            dueFlashcards: dueFlashcardsJSON,
            dueFlashcardsCount: dueFlashcardsJSON.length, // Updated line
            totalFlashcards: this.totalFlashcards,
            subdecks: subdecksJSON,
            originCount: this.originCount,
            // do not include the parent property to avoid circular references
        };
    }

    toJSONWithLimit(): Record<string, any> {
        let maxCount = 14;
        if (this.deckTag.contains("#[[backendread")) {
            maxCount = 3;
        } else if (this.deckTag.contains("read]]")) {
            maxCount = 3;
        } else if (this.deckTag.contains("#[[c]]")) {
            maxCount = 8;
        } else if (this.deckTag.contains("#[[p]]")) {
            maxCount = 8;
        } else if (this.deckTag.startsWith("|Collector|")) {
            maxCount = 3;
        } else if (this.deckTag.startsWith("#[[super thinking index]]")) {
            maxCount = 3;
        } else if (this.deckTag.contains("#[[cquest]]") || this.deckTag.contains("#[[pquest]]")) {
            maxCount = 5;
            // } else if (this.deckTag.contains("#[[zk]]") || this.deckTag.contains("#[[solidity]]")) {
            //     maxCount = 1;
        } else if (this.deckTag.contains("#[[fri]]")) {
            maxCount = 5;
        } else if (this.deckTag.contains("fri")) {
            maxCount = 2;
        } else if (this.deckTag.contains("quest]]")) {
            maxCount = 5;
        } else if (this.deckTag.startsWith("|Backend|")) {
            maxCount = 20;
        } else if (this.deckTag.startsWith("|营销|")) {
            maxCount = 15;
        } else if (this.deckTag.startsWith("|Leetcode|")) {
            maxCount = 7;
        } else if (this.deckTag.startsWith("||")) {
            maxCount = 30;
        } else if (this.deckTag.startsWith("|")) {
            maxCount = 15;
        } else if (this.deckTag.contains("algorithm") || this.deckTag.contains("leetcode-top150")) {
            maxCount = 7;
        } else if (this.deckTag.contains("#[[pquestv]]")) {
            maxCount = 3;
        } else if (this.deckTag.contains("#[[cquestv]]")) {
            maxCount = 3;
        }
        maxCount = maxCount * 2;
        let dueFlashcardsJSON = [];
        let newFlashcardsJSON = [];
        for (let i = 0; i < Math.min(this.newFlashcards.length, maxCount); i++) {
            let card = cardToJSON(this.newFlashcards[i]);
            if (card !== undefined) {
                newFlashcardsJSON.push(card);
            }
        }
        for (
            let i = 0;
            i < Math.min(this.dueFlashcards.length, maxCount - newFlashcardsJSON.length);
            i++
        ) {
            let card = cardToJSON(this.dueFlashcards[i]);
            if (card !== undefined) {
                dueFlashcardsJSON.push(card);
            }
        }
        let subdecksJSON = [];
        for (let i = 0; i < this.subdecks.length; i++) {
            let subdeck = this.subdecks[i].toJSONWithLimit();
            if (subdeck !== undefined) {
                subdecksJSON.push(subdeck);
            }
        }
        this.originCount = dueFlashcardsJSON.length + newFlashcardsJSON.length;
        return {
            deckTag: this.deckTag,
            newFlashcards: newFlashcardsJSON,
            newFlashcardsCount: newFlashcardsJSON.length, // Updated line
            dueFlashcards: dueFlashcardsJSON,
            dueFlashcardsCount: dueFlashcardsJSON.length, // Updated line
            totalFlashcards: this.totalFlashcards,
            subdecks: subdecksJSON,
            originCount: this.originCount,
            // do not include the parent property to avoid circular references
        };
    }

    constructor(deckName: string, parent: Deck | null) {
        this.deckTag = deckName;
        this.newFlashcards = [];
        this.newFlashcardsCount = 0;
        this.dueFlashcards = [];
        this.dueFlashcardsCount = 0;
        this.totalFlashcards = 0;
        this.subdecks = [];
        this.parent = parent;
    }

    sortFlashcards(): void {
        this.dueFlashcards.sort(function (a: Card, b: Card) {
            if (a.delayBeforeReview && b.delayBeforeReview) {
                const aDelayDays = Math.max(
                    0,
                    Math.floor(a.delayBeforeReview / (24 * 3600 * 1000))
                );
                const bDelayDays = Math.max(
                    0,
                    Math.floor(b.delayBeforeReview / (24 * 3600 * 1000))
                );
                const delta = bDelayDays - aDelayDays;
                if (delta !== 0) return delta;
                if (a.front > b.front) {
                    return 1;
                } else {
                    return -1;
                }
            } else {
                if (a.delayBeforeReview) {
                    return 1;
                } else {
                    return -1;
                }
            }
        });
        this.newFlashcards.sort(function (a: Card, b: Card) {
            if (a.front > b.front) {
                return 1;
            } else {
                return -1;
            }
        });
        for (const deck of this.subdecks) {
            deck.sortFlashcards();
        }
    }

    createDeck(deckPath: string[]): void {
        if (deckPath.length === 0) {
            return;
        }

        const deckName: string = deckPath.shift();
        for (const deck of this.subdecks) {
            if (deckName === deck.deckTag) {
                deck.createDeck(deckPath);
                return;
            }
        }

        const deck: Deck = new Deck(deckName, this);
        this.subdecks.push(deck);
        deck.createDeck(deckPath);
    }

    insertFlashcard(deckPath: string[], cardObj: Card): void {
        if (cardObj.isDue) {
            this.dueFlashcardsCount++;
        } else {
            this.newFlashcardsCount++;
        }
        this.totalFlashcards++;

        if (deckPath.length === 0) {
            if (cardObj.isDue) {
                this.dueFlashcards.push(cardObj);
            } else {
                this.newFlashcards.push(cardObj);
            }
            return;
        }

        const deckName: string = deckPath.shift();
        for (const deck of this.subdecks) {
            if (deckName === deck.deckTag) {
                deck.insertFlashcard(deckPath, cardObj);
                return;
            }
        }
    }

    // count flashcards that have either been buried
    // or aren't due yet
    countFlashcard(deckPath: string[], n = 1): void {
        this.totalFlashcards += n;

        const deckName: string = deckPath.shift();
        for (const deck of this.subdecks) {
            if (deckName === deck.deckTag) {
                deck.countFlashcard(deckPath, n);
                return;
            }
        }
    }

    deleteFlashcardAtIndex(index: number, cardIsDue: boolean): void {
        if (cardIsDue) {
            this.dueFlashcards.splice(index, 1);
            this.dueFlashcardsCount--;
        } else {
            this.newFlashcards.splice(index, 1);
            this.newFlashcardsCount--;
        }

        let deck: Deck = this.parent;
        while (deck !== null) {
            if (cardIsDue) {
                deck.dueFlashcardsCount--;
            } else {
                deck.newFlashcardsCount--;
            }
            deck = deck.parent;
        }
    }

    sortSubdecksList(tags: string[]): void {
        this.subdecks.sort((a, b) => {
            const aIndex = tags.indexOf(a.deckTag);
            const bIndex = tags.indexOf(b.deckTag);
            if (aIndex < bIndex) {
                return -1;
            } else if (aIndex > bIndex) {
                return 1;
            }
            return 0;
        });

        for (const deck of this.subdecks) {
            deck.sortSubdecksList(tags);
        }
    }

    getSubdecksList(excludeFlashcardTags: string[]): string[] {
        const tags: string[] = [];
        for (const deck of this.subdecks) {
            if (excludeFlashcardTags.length > 0) {
                if (excludeFlashcardTags.includes(deck.deckTag)) {
                    continue;
                }
            }
            tags.push(deck.deckTag);
        }
        return tags;
    }

    render(containerEl: HTMLElement, modal: FlashcardModal): void {
        const deckView: HTMLElement = containerEl.createDiv("tree-item");
        deckView.setAttribute("data-deck-tag", this.deckTag); // Add a data attribute for easy lookup
        const progress =
            1 - (this.dueFlashcards.length + this.newFlashcards.length) / this.originCount;
        if (progress === 1) {
            deckView.style.opacity = "0.5";
        }
        if (/^\|.+\|$/.test(this.deckTag)) {
            let deckViewSelf = deckView.createDiv("tree-item-name");
            deckViewSelf.innerHTML = `<h3 class="tag-pane-tag-self">${this.deckTag}</h3>`;
            deckViewSelf.addEventListener("click", () => {
                modal.plugin.data.historyDeck = this.deckTag;
                modal.currentDeck = this;
                modal.checkDeck = this.parent;
                modal.setupCardsView();
                this.nextCard(modal);
                // if (Platform.isMobile && 1) {
                //     if (SRPlugin.deckTree.subdecks.length > 1) {
                //         // clear all the other useless deck
                //         SRPlugin.deckTree.subdecks = [this];
                //         FlashcardModal.lastTimeDeck = this;
                //     }
                // }
            });
            return;
        }

        const deckViewSelf: HTMLElement = deckView.createDiv(
            "tree-item-self tag-pane-tag is-clickable"
        );
        let collapsed = true;
        let collapseIconEl: HTMLElement | null = null;
        if (this.subdecks.length > 0) {
            collapseIconEl = deckViewSelf.createDiv("tree-item-icon collapse-icon");
            collapseIconEl.innerHTML = COLLAPSE_ICON;
            (collapseIconEl.childNodes[0] as HTMLElement).style.transform = "rotate(-90deg)";
        }

        const deckViewInner: HTMLElement = deckViewSelf.createDiv("tree-item-inner");
        deckViewSelf.addEventListener("click", () => {
            modal.plugin.data.historyDeck = this.deckTag;
            modal.currentDeck = this;
            modal.checkDeck = this.parent;
            modal.setupCardsView();
            this.nextCard(modal);
            // if (Platform.isMobile && 1) {
            //     if (SRPlugin.deckTree.subdecks.length > 1) {
            //         // clear all the other useless deck
            //         SRPlugin.deckTree.subdecks = [this];
            //         FlashcardModal.lastTimeDeck = this;
            //     }
            // }
        });
        const deckViewInnerText: HTMLElement = deckViewInner.createDiv("tag-pane-tag-text");
        deckViewInnerText.innerHTML += `<span class="tag-pane-tag-self">${this.deckTag}</span>`;
        const deckViewChildren: HTMLElement = deckView.createDiv("tree-item-children");
        deckViewChildren.style.display = "none";
        if (this.subdecks.length > 0) {
            collapseIconEl.addEventListener("click", () => {
                if (collapsed) {
                    (collapseIconEl.childNodes[0] as HTMLElement).style.transform = "";
                    deckViewChildren.style.display = "block";
                } else {
                    (collapseIconEl.childNodes[0] as HTMLElement).style.transform =
                        "rotate(-90deg)";
                    deckViewChildren.style.display = "none";
                }
                collapsed = !collapsed;
            });
        }
        for (const deck of this.subdecks) {
            deck.render(deckViewChildren, modal);
        }
    }

    nextCard(modal: FlashcardModal): void {
        if (this.newFlashcards.length + this.dueFlashcards.length === 0) {
            if (this.dueFlashcardsCount + this.newFlashcardsCount > 0) {
                for (const deck of this.subdecks) {
                    if (deck.dueFlashcardsCount + deck.newFlashcardsCount > 0) {
                        modal.currentDeck = deck;
                        deck.nextCard(modal);
                        return;
                    }
                }
            }

            if (this.parent == modal.checkDeck) {
                modal.plugin.data.historyDeck = "";
                modal.decksList();
            } else {
                this.parent.nextCard(modal);
            }
            return;
        }

        // Update progress bar after card navigation
        const currentTotal = this.dueFlashcards.length + this.newFlashcards.length;
        const progress = 1 - currentTotal / this.originCount;
        let progressPercent = Math.round(progress * 100);
        if (progressPercent < 0) {
            progressPercent = 0;
        }
        modal.progressBar.style.width = `${progressPercent}%`;

        // Update progress text
        modal.progressText.textContent = `Progress: ${progressPercent}%`;

        modal.responseDiv.style.display = "none";
        modal.resetLinkView.style.display = "none";
        // modal.titleEl.setText(
        //     `${this.deckName}: ${this.dueFlashcardsCount + this.newFlashcardsCount}`
        // );

        modal.answerBtn.style.display = "initial";
        modal.flashcardView.innerHTML = "";
        modal.mode = FlashcardModalMode.Front;

        let interval = 1.0,
            ease: number = modal.plugin.data.settings.baseEase,
            delayBeforeReview = 0;
        if (this.newFlashcards.length > 0) {
            if (modal.plugin.data.settings.randomizeCardOrder) {
                const pickedCardIdx = Math.floor(Math.random() * this.newFlashcards.length);
                modal.currentCardIdx = pickedCardIdx;

                // look for first unscheduled sibling
                const pickedCard: Card = this.newFlashcards[pickedCardIdx];
                let idx = pickedCardIdx;
                while (idx >= 0 && pickedCard.siblings.includes(this.newFlashcards[idx])) {
                    if (!this.newFlashcards[idx].isDue) {
                        modal.currentCardIdx = idx;
                    }
                    idx--;
                }
            } else {
                modal.currentCardIdx = 0;
            }

            modal.currentCard = this.newFlashcards[modal.currentCardIdx];

            if (
                Object.prototype.hasOwnProperty.call(
                    modal.plugin.easeByPath,
                    modal.currentCard.note.path
                )
            ) {
                ease = modal.plugin.easeByPath[modal.currentCard.note.path];
            }
        } else if (this.dueFlashcards.length > 0) {
            if (modal.plugin.data.settings.randomizeCardOrder) {
                modal.currentCardIdx = Math.floor(Math.random() * this.dueFlashcards.length);
            } else {
                modal.currentCardIdx = 0;
            }
            modal.currentCard = this.dueFlashcards[modal.currentCardIdx];

            interval = modal.currentCard.interval;
            ease = modal.currentCard.ease;
            delayBeforeReview = modal.currentCard.delayBeforeReview;
        }

        const hardInterval: number = schedule(
            ReviewResponse.Hard,
            interval,
            ease,
            delayBeforeReview,
            modal.plugin.data.settings
        ).interval;
        const goodInterval: number = schedule(
            ReviewResponse.Good,
            interval,
            ease,
            delayBeforeReview,
            modal.plugin.data.settings
        ).interval;
        const easyInterval: number = schedule(
            ReviewResponse.Easy,
            interval,
            ease,
            delayBeforeReview,
            modal.plugin.data.settings
        ).interval;

        if (modal.ignoreStats) {
            // Same for mobile/desktop
            modal.hardBtn.setText(`${t("HARD")}`);
            modal.easyBtn.setText(`${t("EASY")}`);
            modal.skipBtn.setText(`${t("SKIP")}`);
        } else if (Platform.isMobile) {
            modal.hardBtn.setText(textInterval(hardInterval, true));
            modal.goodBtn.setText(textInterval(goodInterval, true));
            modal.easyBtn.setText(textInterval(easyInterval, true));
            // modal.skipBtn.setText(textInterval(easyInterval, true));
        } else {
            modal.hardBtn.setText(`${t("HARD")} - ${textInterval(hardInterval, false)}`);
            modal.goodBtn.setText(`${t("GOOD")} - ${textInterval(goodInterval, false)}`);
            modal.easyBtn.setText(`${t("EASY")} - ${textInterval(easyInterval, false)}`);
            // modal.skipBtn.setText(`${t("SKIP")} - ${textInterval(easyInterval, false)}`);
        }

        if (modal.plugin.data.settings.showContextInCards)
            modal.contextView.setText(modal.currentCard.context);
        if (modal.plugin.data.settings.showFileNameInFileLink)
            modal.fileLinkView.setText(modal.currentCard.note.basename);

        if (
            modal.currentCard.cardText !== undefined &&
            // modal.currentCard.cardText.contains("#[[bv]]") ||
            (modal.currentCard.cardText.contains("//x.com") ||
                // modal.currentCard.cardText.contains("#[[b]]") ||
                modal.currentCard.cardText.contains("#[[bquest]]"))
            // modal.currentCard.cardText.contains("#[[bquestv]]")
            // && false
        ) {
            modal.processReview(ReviewResponse.Hard);
        } else {
            modal.renderMarkdownWrapper("- Q:\n" + modal.currentCard.front, modal.flashcardView);
        }
    }
}
