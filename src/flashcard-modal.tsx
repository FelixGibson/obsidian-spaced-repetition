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

export enum FlashcardModalMode {
    DecksList,
    Front,
    Back,
    Closed,
}

export const pluginName = "yet-another-obsidian-spaced-repetition";

export class FlashcardModal extends Modal {
    public plugin: SRPlugin;
    public answerBtn: HTMLElement;
    public flashcardView: HTMLElement;
    public hardBtn: HTMLElement;
    public skipBtn: HTMLElement;
    public goodBtn: HTMLElement;
    public easyBtn: HTMLElement;
    public deleteBtn: HTMLElement;
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
    public timerId: NodeJS.Timeout | null = null;
    public timerDuration = 20000; // 20 seconds
    public timerProgressBar: HTMLElement;
    public timerProgressContainer: HTMLElement;
    public resetTimerBtn: HTMLElement;

    constructor(app: App, plugin: SRPlugin, ignoreStats = false) {
        super(app);

        this.plugin = plugin;

        this.titleEl.setText(t("DECKS"));
        this.ignoreStats = ignoreStats;

        if (Platform.isMobile) {
            this.contentEl.style.display = "block";
        }
        this.modalEl.style.height = this.plugin.data.settings.flashcardHeightPercentage + "%";
        this.modalEl.style.width = this.plugin.data.settings.flashcardWidthPercentage + "%";

        this.contentEl.style.position = "relative";
        this.contentEl.style.height = "92%";
        this.contentEl.addClass("sr-modal-content");

        document.body.onkeydown = async (e) => {
            if (this.isProcessing) return;

            if (this.mode !== FlashcardModalMode.DecksList) {
                if (this.mode !== FlashcardModalMode.Closed && e.code === "KeyS") {
                    this.currentDeck.deleteFlashcardAtIndex(
                        this.currentCardIdx,
                        this.currentCard.isDue
                    );
                    await this.burySiblingCards(false);
                    await this.currentDeck.nextCard(this);
                } else if (
                    this.mode === FlashcardModalMode.Front &&
                    (e.code === "Space" || e.code === "Enter")
                ) {
                    await this.showAnswer();
                } else if (this.mode === FlashcardModalMode.Back) {
                    try {
                        // 添加错误处理
                        if (e.code === "Numpad1" || e.code === "Digit1") {
                            await this.processReview(ReviewResponse.Hard); // 添加 await
                        } else if (
                            e.code === "Numpad2" ||
                            e.code === "Digit2" ||
                            e.code === "Space"
                        ) {
                            await this.processReview(ReviewResponse.Good);
                        } else if (e.code === "Numpad3" || e.code === "Digit3") {
                            await this.processReview(ReviewResponse.Easy);
                        } else if (e.code === "Numpad4" || e.code === "Digit4") {
                            await this.processReview(ReviewResponse.Reset);
                        } else if (e.code === "Numpad5" || e.code === "Digit5") {
                            await this.processReview(ReviewResponse.Skip);
                        }
                        // else if (e.code === "Numpad6" || e.code === "Digit6") {
                        //     await this.processReview(ReviewResponse.Delete);
                        // }
                    } catch (error) {
                        console.error("处理键盘事件失败:", error);
                        new Notice("操作失败，请检查控制台日志");
                    }
                }
            }
        };
    }

    private static initialized = false;

    clearTimer(): void {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        if (this.timerProgressContainer) {
            this.timerProgressContainer.style.display = "none";
            this.resetTimerBtn.style.display = "none";
        }
    }

    startTimer(): void {
        this.clearTimer();

        if (this.timerProgressContainer) {
            this.timerProgressContainer.style.display = "block";
            this.resetTimerBtn.style.display = "inline-block";
            // Force a reflow to restart the animation
            this.timerProgressBar.style.transition = "none";
            this.timerProgressBar.style.width = "100%";
            void this.timerProgressBar.offsetWidth;

            this.timerProgressBar.style.transition = `width ${this.timerDuration / 1000}s linear`;
            this.timerProgressBar.style.width = "0%";
        }

        this.timerId = setTimeout(async () => {
            if (this.isProcessing) return;
            this.isProcessing = true;
            try {
                await this.processReview(ReviewResponse.Good);
            } finally {
                this.isProcessing = false;
            }
        }, this.timerDuration);
    }

    resetTimer(): void {
        this.startTimer();
    }

    async onOpen(): Promise<void> {
        if (FlashcardModal.isClosing || FlashcardModal.isOpening) return; // 同时检查打开状态
        FlashcardModal.isOpening = true; // 加锁

        try {
            await this.decksList();
        } finally {
            FlashcardModal.isOpening = false; // 确保释放锁
        }
    }
    private static isClosing = false;
    private static isOpening = false; // 新增打开状态锁

    async onClose(): Promise<void> {
        this.clearTimer();
        try {
            if (FlashcardModal.isClosing || FlashcardModal.isOpening) return;
            FlashcardModal.isClosing = true;
            if (SRPlugin.deckTree) {
                // 直接保存每个deck到单独的文件
                for (const deck of SRPlugin.deckTree.subdecks) {
                    await this.plugin.saveDeckCache(
                        deck.deckTag,
                        deck.toJSONWithLimit(this.plugin.data.settings.tagLimits)
                    );
                }

                // 保存根deck信息到主cache.json文件
                const rootDeckData = SRPlugin.deckTree.toJSONWithLimit(
                    this.plugin.data.settings.tagLimits
                );
                const rootDeckOnly = {
                    deckTag: rootDeckData.deckTag,
                    newFlashcards: rootDeckData.newFlashcards || [],
                    newFlashcardsCount: rootDeckData.newFlashcardsCount || 0,
                    dueFlashcards: rootDeckData.dueFlashcards || [],
                    dueFlashcardsCount: rootDeckData.dueFlashcardsCount || 0,
                    totalFlashcards: rootDeckData.totalFlashcards || 0,
                    originCount: rootDeckData.originCount || 0,
                    subdecks: [] as Deck[], // 清空subdecks数组
                };

                // 更新cacheDeckString，只包含根deck信息
                this.plugin.cacheDeckString = JSON.stringify(rootDeckOnly);

                // 保存主cache.json文件
                const cachePath = `${this.plugin.app.vault.configDir}/plugins/${pluginName}/cache.json`;
                await this.plugin.app.vault.adapter.write(cachePath, this.plugin.cacheDeckString);
            }
            this.mode = FlashcardModalMode.Closed;
        } catch (error) {
            console.error("保存失败:", error);
        } finally {
            FlashcardModal.isClosing = false;
        }
    }

    public static lastTimeDeck: Deck = null;

    async decksList(): Promise<void> {
        this.clearTimer();
        const aimDeck = SRPlugin.deckTree.subdecks.filter(
            (deck) => deck.deckTag === this.plugin.data.historyDeck
        );

        // 如果在SRPlugin.deckTree.subdecks中找不到historyDeck，尝试从deckTagToFileMap中加载
        if (this.plugin.data.historyDeck && aimDeck.length === 0) {
            const loadedDeck = await this.plugin.loadDeckByTag(this.plugin.data.historyDeck);
            if (loadedDeck) {
                // 将加载的deck添加到SRPlugin.deckTree.subdecks中
                const existingDeckIndex = SRPlugin.deckTree.subdecks.findIndex(
                    (deck) => deck.deckTag === loadedDeck.deckTag
                );
                if (existingDeckIndex === -1) {
                    SRPlugin.deckTree.subdecks.push(loadedDeck);
                } else {
                    // 如果已存在，则替换为加载的deck
                    SRPlugin.deckTree.subdecks[existingDeckIndex] = loadedDeck;
                }

                this.currentDeck = loadedDeck;
                this.checkDeck = loadedDeck.parent;
                this.setupCardsView();
                await loadedDeck.nextCard(this);
                return;
            }
        }

        if (this.plugin.data.historyDeck && aimDeck.length > 0) {
            const deck = aimDeck[0];

            this.currentDeck = deck;
            this.checkDeck = deck.parent;
            this.setupCardsView();
            await deck.nextCard(this);
            return;
        }

        this.mode = FlashcardModalMode.DecksList;
        this.titleEl.setText(t("DECKS"));
        this.contentEl.innerHTML = "";
        this.contentEl.setAttribute("id", "sr-flashcard-view");
        // 添加搜索框
        const searchBox = this.contentEl.createEl("input", {
            type: "text",
            attr: { placeholder: t("SEARCH_DECKS") },
            cls: "sr-deck-search",
        });
        searchBox.addEventListener("input", async (e) => {
            const keyword = (e.target as HTMLInputElement).value.toLowerCase();
            await this.renderDeckList(keyword);
        });
        await this.renderDeckList(); // 初始渲染
    }

    // 新增渲染方法
    public async renderDeckList(keyword?: string): Promise<void> {
        // 清空容器中除搜索框外的所有内容
        Array.from(this.contentEl.children).forEach((child) => {
            if (!child.classList.contains("sr-deck-search")) {
                child.remove();
            }
        });

        // 直接创建新容器（无需克隆）
        const sidebarEl = this.contentEl.createDiv({
            cls: "sidebar",
            attr: { id: "title-sidebar" },
        });
        const mainContentEl = this.contentEl.createDiv({
            cls: "main-content",
        });

        // 从deckTagToFileMap获取所有deck标签，而不是使用SRPlugin.deckTree.subdecks
        const deckTags = Object.keys(this.plugin.deckTagToFileMap);

        // 创建deck对象数组用于过滤和渲染
        const decks: Deck[] = [];
        for (const deckTag of deckTags) {
            // 创建空的deck壳，不加载实际内容
            const deck = new Deck(deckTag, null);
            decks.push(deck);
        }

        // 过滤deck列表 (保持原逻辑)
        const filteredDecks = decks.filter((deck) => {
            if (this.plugin.data.settings.excludeFlashcardTags.includes(deck.deckTag)) {
                return false;
            }
            return !keyword || deck.deckTag.toLowerCase().includes(keyword);
        });

        // 生成侧边栏标题（保持原有逻辑）
        filteredDecks.forEach((deck) => {
            const pipeCount = deck.deckTag.match(/^\|+/)?.[0]?.length || 0;
            if (pipeCount > 0 && pipeCount <= 6) {
                const level = Math.min(pipeCount, 6);
                const titleText = deck.deckTag.replace(/\|+/g, "");

                const titleItem = sidebarEl.createDiv(`sidebar-item sidebar-item-level${level}`);
                titleItem.innerText = titleText;
                titleItem.setAttribute("data-deck-tag", deck.deckTag);

                titleItem.addEventListener("click", () => {
                    const targetDeckEl = mainContentEl.querySelector(
                        `[data-deck-tag="${deck.deckTag}"]`
                    );
                    targetDeckEl?.scrollIntoView({ behavior: "auto", block: "start" });
                });
            }
        });

        // 渲染主内容
        filteredDecks.forEach(async (deck) => {
            await deck.render(mainContentEl, this);
        });

        this.contentEl.appendChild(sidebarEl);
        this.contentEl.appendChild(mainContentEl);
    }
    private isProcessing = false; // 新增防抖状态标志

    setupCardsView(): void {
        this.contentEl.innerHTML = "";
        this.contentEl.setAttribute("id", "sr-flashcard-view-qa");
        const historyLinkView = this.contentEl.createEl("button");
        historyLinkView.setAttribute("id", "sr-history-link");
        historyLinkView.setText("〈");
        historyLinkView.addEventListener("click", async (e: PointerEvent) => {
            if (e.pointerType.length > 0) {
                this.plugin.data.historyDeck = "";
                await this.decksList();
            }
        });
        const createDebouncedHandler = (response: ReviewResponse) => {
            return async () => {
                if (this.isProcessing) return;
                this.isProcessing = true;
                try {
                    await this.processReview(response);
                } finally {
                    this.isProcessing = false;
                }
            };
        };

        this.fileLinkView = this.contentEl.createDiv("sr-link");
        this.fileLinkView.setText(t("EDIT_LATER"));
        if (this.plugin.data.settings.showFileNameInFileLink) {
            this.fileLinkView.setAttribute("aria-label", t("EDIT_LATER"));
        }
        this.fileLinkView.addEventListener("click", async () => {
            const activeLeaf: WorkspaceLeaf = this.plugin.app.workspace.activeLeaf;
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
                await activeLeaf.openFile(this.currentCard.note, {
                    active: true,
                    eState: n,
                });
            } else {
                await activeLeaf.openFile(this.currentCard.note);
                const activeView: MarkdownView =
                    this.app.workspace.getActiveViewOfType(MarkdownView);
                await activeView.editor.setCursor({
                    line: this.currentCard.lineNo,
                    ch: 0,
                });
                activeView.editor.scrollTo(this.currentCard.lineNo, 0);
            }
        });

        this.resetLinkView = this.contentEl.createDiv("sr-link");
        this.resetLinkView.setText(t("RESET_CARD_PROGRESS"));
        this.resetLinkView.addEventListener("click", createDebouncedHandler(ReviewResponse.Reset));

        this.resetLinkView.style.float = "right";
        // Create the Progress Bar
        this.progressContainer = this.contentEl.createDiv("sr-progress-container");

        // Add Progress Track
        const progressTrack = this.progressContainer.createDiv("sr-progress-track");

        // Add Progress Bar inside the Track
        this.progressBar = progressTrack.createDiv("sr-progress-bar");

        // Add Progress Text
        this.progressText = this.progressContainer.createSpan("sr-progress-text");
        // Add the new timer progress bar
        this.timerProgressContainer = this.contentEl.createDiv("sr-timer-progress-container");
        this.timerProgressBar = this.timerProgressContainer.createDiv("sr-timer-progress-bar");
        this.timerProgressContainer.style.display = "none";

        // Add the reset timer button
        this.resetTimerBtn = this.contentEl.createEl("button", {
            text: t("RESET_TIMER"),
            cls: "sr-reset-timer-btn",
        });
        this.resetTimerBtn.addEventListener("click", () => {
            this.resetTimer();
        });
        this.resetTimerBtn.style.display = "none"; // Initially hidden

        this.deleteBtn = document.createElement("button");
        this.deleteBtn.setAttribute("id", "sr-delete-btn");
        this.deleteBtn.setText(t("DELETE"));
        this.deleteBtn.addEventListener("click", createDebouncedHandler(ReviewResponse.Delete));
        this.contentEl.appendChild(this.deleteBtn);
        this.deleteBtn.style.display = "none";

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
        this.hardBtn.addEventListener("click", createDebouncedHandler(ReviewResponse.Hard));

        this.responseDiv.appendChild(this.hardBtn);

        this.goodBtn = document.createElement("button");
        this.goodBtn.setAttribute("id", "sr-good-btn");
        this.goodBtn.setText(t("GOOD"));
        this.goodBtn.addEventListener("click", createDebouncedHandler(ReviewResponse.Good));

        this.responseDiv.appendChild(this.goodBtn);

        this.easyBtn = document.createElement("button");
        this.easyBtn.setAttribute("id", "sr-easy-btn");
        this.easyBtn.setText(t("EASY"));
        this.easyBtn.addEventListener("click", createDebouncedHandler(ReviewResponse.Easy));

        this.responseDiv.appendChild(this.easyBtn);

        this.skipBtn = document.createElement("button");
        this.skipBtn.setAttribute("id", "sr-skip-btn");
        this.skipBtn.setText(t("SKIP"));
        this.skipBtn.addEventListener("click", createDebouncedHandler(ReviewResponse.Skip));

        this.responseDiv.appendChild(this.skipBtn);

        this.responseDiv.style.display = "none";

        this.answerBtn = this.contentEl.createDiv();
        this.answerBtn.setAttribute("id", "sr-show-answer");
        this.answerBtn.setText(t("SHOW_ANSWER"));
        this.answerBtn.addEventListener("click", async () => {
            await this.showAnswer();
        });

        if (this.ignoreStats) {
            this.goodBtn.style.display = "none";

            this.responseDiv.addClass("sr-ignorestats-response");
            this.easyBtn.addClass("sr-ignorestats-btn");
            this.hardBtn.addClass("sr-ignorestats-btn");
            this.skipBtn.addClass("sr-ignorestats-btn");
        }
    }

    async showAnswer(): Promise<void> {
        this.clearTimer();
        this.mode = FlashcardModalMode.Back;

        this.answerBtn.style.display = "none";
        this.responseDiv.style.display = "grid";
        this.deleteBtn.style.display = "inline-block";

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

        await this.renderMarkdownWrapper("- A:\n" + this.currentCard.back, this.flashcardView);
    }
    async deleteCurrentCard(): Promise<void> {
        try {
            // 从笔记文件中删除卡片
            let fileText: string = await this.app.vault.read(this.currentCard.note);

            // 创建一个更强大的正则表达式来匹配卡片文本及其可能关联的SR注释
            // 1. 首先尝试匹配卡片文本后紧跟的SR注释
            const cardWithSRRgx = new RegExp(
                escapeRegexString(this.currentCard.cardText) + "(\\s*<!--SR:.+?-->)?",
                "gm"
            );

            // 2. 对于多行卡片，需要特殊处理
            let deletionSuccessful = false;
            if (this.currentCard.cardType === CardType.MultiLineBasic) {
                // 处理多行卡片
                const multilineRegex = new RegExp(
                    `^[\\t ]*${escapeRegex(this.plugin.data.settings.multilineCardSeparator)}`,
                    "gm"
                );
                const questionLastIdx = this.currentCard.cardText.search(multilineRegex) - 1;
                const question = this.currentCard.cardText.substring(0, questionLastIdx);

                // 尝试匹配问题部分及其可能关联的SR注释
                const questionWithSRRgx = new RegExp(
                    escapeRegexString(question) + "(\\s*<!--SR:.+?-->)?",
                    "gm"
                );

                if (questionWithSRRgx.test(fileText)) {
                    fileText = fileText.replace(questionWithSRRgx, "");
                    deletionSuccessful = true;
                }
            }

            // 如果多行卡片处理失败或不是多行卡片，使用通用方法
            if (!deletionSuccessful) {
                // 尝试使用更精确的匹配
                if (cardWithSRRgx.test(fileText)) {
                    fileText = fileText.replace(cardWithSRRgx, "");
                } else {
                    // 如果上面的匹配失败，回退到原始方法
                    const replacementRegex = new RegExp(
                        escapeRegexString(this.currentCard.cardText),
                        "gm"
                    );
                    fileText = fileText.replace(replacementRegex, "");
                }
            }

            // 清理可能留下的多余空行
            fileText = fileText.replace(/\n{3,}/g, "\n\n");

            // 如果删除后文件为空或只包含空白字符，可以添加一个空行
            if (!fileText.trim()) {
                fileText = "\n";
            }

            await this.app.vault.modify(this.currentCard.note, fileText);

            // 显示删除成功的通知
            new Notice("卡片已删除: " + this.currentCard.cardText);

            // 移动到下一张卡片
            await this.nextCard();
        } catch (error) {
            console.error("删除卡片时出错:", error);
            new Notice("删除卡片失败，请检查控制台日志");
        }
    }

    async processReview(response: ReviewResponse): Promise<void> {
        this.clearTimer();
        try {
            if (this.ignoreStats) {
                if (response == ReviewResponse.Easy) {
                    this.currentDeck.deleteFlashcardAtIndex(
                        this.currentCardIdx,
                        this.currentCard.isDue
                    );
                }
                await this.currentDeck.nextCard(this);
                return;
            }

            let interval: number, ease: number, due;

            this.currentDeck.deleteFlashcardAtIndex(this.currentCardIdx, this.currentCard.isDue);
            if (
                response !== ReviewResponse.Reset &&
                response !== ReviewResponse.Skip &&
                response !== ReviewResponse.Delete
            ) {
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
                        initial_ease = Math.round(
                            this.plugin.easeByPath[this.currentCard.note.path]
                        );
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
                await this.nextCard();
                return;
            } else if (response === ReviewResponse.Delete) {
                await this.deleteCurrentCard();
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
                        questionWithoutSchedule +
                        sep +
                        `<!--SR:!${dueString},${interval},${ease}-->`;
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
                        this.currentCard.cardText +
                        sep +
                        `<!--SR:!${dueString},${interval},${ease}-->`;
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

                    this.currentCard.cardText = this.currentCard.cardText.replace(
                        /<!--SR:.+-->/gm,
                        ""
                    );
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
                await this.burySiblingCards(true);
            }

            await this.app.vault.modify(this.currentCard.note, fileText);
            // random score
            await this.ding("Good Job" + " " + 0.3);

            await this.nextCard();
        } catch (error) {
            console.error("处理复习时出错:", error);
        } finally {
            this.isProcessing = false;
        }
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
                new Notice(
                    ` ${triple[0].toFixed(8)}% \n ${star}   ${Math.round(triple[2])} points`
                );
                console.log(
                    `chance: ${triple[0].toFixed(2)} of ${triple[1]}X : ${Math.round(triple[2])}`
                );
                settings.profit = Math.round(value + triple[2]);
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

    async nextCard(): Promise<void> {
        // // refresh cache
        // const cacheDeckString = JSON.stringify(
        //     SRPlugin.deckTree.toJSONWithLimit(this.plugin.data.settings.tagLimits)
        // );
        // this.plugin.data.settings.cacheDeckString = cacheDeckString;
        // this.plugin.savePluginData();
        await this.currentDeck.nextCard(this);
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

        await this.renderMarkdownWrapper(blockText, el, recursiveDepth + 1);
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

    // toJSON(): Record<string, any> {
    //     let dueFlashcardsJSON = [];
    //     let newFlashcardsJSON = [];
    //     for (let i = 0; i < this.newFlashcards.length; i++) {
    //         let card = cardToJSON(this.newFlashcards[i]);
    //         if (card !== undefined) {
    //             newFlashcardsJSON.push(card);
    //         }
    //     }
    //     for (let i = 0; i < this.dueFlashcards.length; i++) {
    //         let card = cardToJSON(this.dueFlashcards[i]);
    //         if (card !== undefined) {
    //             dueFlashcardsJSON.push(card);
    //         }
    //     }
    //     let subdecksJSON = [];
    //     for (let i = 0; i < this.subdecks.length; i++) {
    //         let subdeck = this.subdecks[i].toJSON();
    //         if (subdeck !== undefined) {
    //             subdecksJSON.push(subdeck);
    //         }
    //     }
    //     return {
    //         deckTag: this.deckTag,
    //         newFlashcards: newFlashcardsJSON,
    //         newFlashcardsCount: newFlashcardsJSON.length, // Updated line
    //         dueFlashcards: dueFlashcardsJSON,
    //         dueFlashcardsCount: dueFlashcardsJSON.length, // Updated line
    //         totalFlashcards: this.totalFlashcards,
    //         subdecks: subdecksJSON,
    //         originCount: this.originCount,
    //         // do not include the parent property to avoid circular references
    //     };
    // }

    toJSONWithLimit(tagLimits: Record<string, number>): Record<string, any> {
        let maxCount = 30;
        // if (this.deckTag.contains("#[[backendread")) {
        //     maxCount = 3;
        // } else if (this.deckTag.contains("read]]")) {
        //     maxCount = 1;
        // } else if (this.deckTag.contains("#[[c]]")) {
        //     maxCount = 8;
        // } else if (this.deckTag.contains("#[[p]]")) {
        //     maxCount = 8;
        // } else if (this.deckTag.startsWith("|Collector|")) {
        //     maxCount = 3;
        // } else if (this.deckTag.startsWith("#[[super thinking index]]")) {
        //     maxCount = 3;
        // } else if (this.deckTag.contains("#[[cquest]]") || this.deckTag.contains("#[[pquest]]")) {
        //     maxCount = 1;
        //     // } else if (this.deckTag.contains("#[[zk]]") || this.deckTag.contains("#[[solidity]]")) {
        //     //     maxCount = 1;
        // } else if (this.deckTag.contains("#[[fri]]")) {
        //     maxCount = 5;
        // } else if (this.deckTag.contains("fri")) {
        //     maxCount = 2;
        // } else if (this.deckTag.contains("quest]]")) {
        //     maxCount = 5;
        // } else if (this.deckTag.startsWith("|Backend|")) {
        //     maxCount = 20;
        // } else if (this.deckTag.startsWith("|营销|")) {
        //     maxCount = 15;
        // } else if (this.deckTag.startsWith("|Leetcode|")) {
        //     maxCount = 7;
        // } else if (this.deckTag.startsWith("||")) {
        //     maxCount = 30;
        // } else if (this.deckTag.startsWith("|")) {
        //     maxCount = 15;
        // } else if (this.deckTag.contains("algorithm") || this.deckTag.contains("leetcode-top150")) {
        //     maxCount = 7;
        // } else if (this.deckTag.contains("#[[pquestv]]")) {
        //     maxCount = 3;
        // } else if (this.deckTag.contains("#[[cquestv]]")) {
        //     maxCount = 3;
        // }
        if (tagLimits[this.deckTag] !== undefined) {
            maxCount = tagLimits[this.deckTag];
        }

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
            let subdeck = this.subdecks[i].toJSONWithLimit(tagLimits);
            if (subdeck !== undefined) {
                subdecksJSON.push(subdeck);
            }
        }
        if (this.originCount == 0) {
            // 否则，保留第一次之前的数量方便统计progress
            this.originCount = dueFlashcardsJSON.length + newFlashcardsJSON.length;
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

    async render(containerEl: HTMLElement, modal: FlashcardModal): Promise<void> {
        const deckView: HTMLElement = containerEl.createDiv("tree-item");
        deckView.setAttribute("data-deck-tag", this.deckTag); // Add a data attribute for easy lookup

        const progress =
            1 - (this.dueFlashcards.length + this.newFlashcards.length) / this.originCount;
        if (progress === 1) {
            deckView.style.opacity = "0.2";
            // Also set opacity for matching sidebar item
            const sidebarItem = document.querySelector(`[data-deck-tag="${this.deckTag}"]`);
            if (sidebarItem) {
                (sidebarItem as HTMLElement).style.opacity = "0.2";
            }
        }
        if (/^\|.+\|$/.test(this.deckTag)) {
            const deckViewSelf = deckView.createDiv("tree-item-name");
            deckViewSelf.innerHTML = `<h3 class="tag-pane-tag-self">${this.deckTag}</h3>`;
            deckViewSelf.addEventListener("click", async () => {
                const loadedDeck = await modal.plugin.loadDeckByTag(this.deckTag);
                if (loadedDeck) {
                    modal.plugin.data.historyDeck = loadedDeck.deckTag;
                    modal.currentDeck = loadedDeck;
                    modal.checkDeck = loadedDeck;

                    // 将加载的deck添加到SRPlugin.deckTree.subdecks中，如果不存在的话
                    const existingDeckIndex = SRPlugin.deckTree.subdecks.findIndex(
                        (deck) => deck.deckTag === loadedDeck.deckTag
                    );
                    if (existingDeckIndex === -1) {
                        SRPlugin.deckTree.subdecks.push(loadedDeck);
                    } else {
                        // 如果已存在，则替换为加载的deck
                        SRPlugin.deckTree.subdecks[existingDeckIndex] = loadedDeck;
                    }

                    modal.setupCardsView();
                    await loadedDeck.nextCard(modal);
                }
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

        const deckViewInnerText: HTMLElement = deckViewInner.createDiv("tag-pane-tag-text");
        deckViewInnerText.innerHTML += `<span class="tag-pane-tag-self">${this.deckTag}</span>`;
        deckViewInnerText.addEventListener("click", async () => {
            const loadedDeck = await modal.plugin.loadDeckByTag(this.deckTag);
            if (loadedDeck) {
                modal.plugin.data.historyDeck = loadedDeck.deckTag;
                modal.currentDeck = loadedDeck;
                modal.checkDeck = loadedDeck;

                // 将加载的deck添加到SRPlugin.deckTree.subdecks中，如果不存在的话
                const existingDeckIndex = SRPlugin.deckTree.subdecks.findIndex(
                    (deck) => deck.deckTag === loadedDeck.deckTag
                );
                if (existingDeckIndex === -1) {
                    SRPlugin.deckTree.subdecks.push(loadedDeck);
                } else {
                    // 如果已存在，则替换为加载的deck
                    SRPlugin.deckTree.subdecks[existingDeckIndex] = loadedDeck;
                }

                modal.setupCardsView();
                await loadedDeck.nextCard(modal);
            }
            // if (Platform.isMobile && 1) {
            //     if (SRPlugin.deckTree.subdecks.length > 1) {
            //         // clear all the other useless deck
            //         SRPlugin.deckTree.subdecks = [this];
            //         FlashcardModal.lastTimeDeck = this;
            //     }
            // }
        });

        const btnContainer = deckViewInner.createDiv("sr-locate-btn-container");

        // 定位按钮（移动到标题文本右侧）
        const locateBtn = btnContainer.createEl("button", {
            cls: "sr-locate-btn",
            attr: { "aria-label": t("LOCATE_DECK") },
        });
        locateBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>`;

        // 修改定位按钮点击逻辑
        locateBtn.addEventListener("click", async () => {
            // 获取搜索框并清空内容
            const searchBox = modal.contentEl.querySelector(".sr-deck-search") as HTMLInputElement;
            if (searchBox) {
                searchBox.value = "";
                // 触发重新渲染完整列表
                await modal.renderDeckList();

                // 在新的容器中找到目标元素
                const mainContent = modal.contentEl.querySelector(".main-content");
                const targetDeckEl = mainContent.querySelector(`[data-deck-tag="${this.deckTag}"]`);
                targetDeckEl?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            }
        });
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
            await deck.render(deckViewChildren, modal);
        }
    }

    async nextCard(modal: FlashcardModal): Promise<void> {
        if (this.newFlashcards.length + this.dueFlashcards.length === 0) {
            if (this.dueFlashcardsCount + this.newFlashcardsCount > 0) {
                for (const deck of this.subdecks) {
                    if (deck.dueFlashcardsCount + deck.newFlashcardsCount > 0) {
                        modal.currentDeck = deck;
                        await deck.nextCard(modal);
                        return;
                    }
                }
            }

            if (this.parent == modal.checkDeck) {
                modal.plugin.data.historyDeck = "";
                await modal.decksList();
            } else {
                await this.parent.nextCard(modal);
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
        modal.deleteBtn.style.display = "none";
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
            (modal.currentCard.cardText.contains("#[[bv]]") ||
                modal.currentCard.cardText.contains("//x.com") ||
                modal.currentCard.cardText.contains("#[[b]]") ||
                modal.currentCard.cardText.contains("#[[bquest]]") ||
                modal.currentCard.cardText.contains("#[[bquestv]]") ||
                modal.currentCard.cardText.contains("weibo") ||
                modal.currentCard.cardText.contains("invest") ||
                modal.currentCard.cardText.contains("business"))
            // && false
        ) {
            await modal.processReview(ReviewResponse.Good);
        } else {
            await modal.renderMarkdownWrapper(
                "- Q:\n" + modal.currentCard.front,
                modal.flashcardView
            );
            modal.startTimer();
        }
    }
}
