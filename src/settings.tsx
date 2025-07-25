import { Notice, PluginSettingTab, Setting, App, Platform } from "obsidian";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import h from "vhtml";

import SRPlugin from "src/main";
import { t } from "src/lang/helpers";

export interface SRSettings {
    tagLimits: Record<string, number>;
    // flashcards
    flashcardTags: string[];
    profit: number;
    excludeFlashcardTags: string[];
    convertFoldersToDecks: boolean;
    cardCommentOnSameLine: boolean;
    burySiblingCards: boolean;
    showContextInCards: boolean;
    flashcardHeightPercentage: number;
    flashcardWidthPercentage: number;
    showFileNameInFileLink: boolean;
    randomizeCardOrder: boolean;
    convertHighlightsToClozes: boolean;
    convertBoldTextToClozes: boolean;
    singlelineCardSeparator: string;
    singlelineReversedCardSeparator: string;
    multilineCardSeparator: string;
    lastSyncDate: string;
    multilineReversedCardSeparator: string;
    // notes
    tagsToReview: string[];
    noteFoldersToIgnore: string[];
    openRandomNote: boolean;
    autoNextNote: boolean;
    disableFileMenuReviewOptions: boolean;
    maxNDaysNotesReviewQueue: number;
    // algorithm
    baseEase: number;
    lapsesIntervalChange: number;
    easyBonus: number;
    maximumInterval: number;
    maxLinkFactor: number;
    // logging
    showDebugMessages: boolean;
}

export const DEFAULT_SETTINGS: SRSettings = {
    tagLimits: {},
    // flashcards
    flashcardTags: ["#flashcards"],
    profit: 10000,
    excludeFlashcardTags: ["#ignore"],
    convertFoldersToDecks: false,
    cardCommentOnSameLine: true,
    burySiblingCards: false,
    showContextInCards: false,
    flashcardHeightPercentage: 100,
    flashcardWidthPercentage: 100,
    showFileNameInFileLink: true,
    randomizeCardOrder: false,
    convertHighlightsToClozes: false,
    convertBoldTextToClozes: false,
    singlelineCardSeparator: ";;",
    singlelineReversedCardSeparator: ";;;",
    multilineCardSeparator: "?",
    lastSyncDate: "",
    multilineReversedCardSeparator: "??",
    // notes
    tagsToReview: ["#review"],
    noteFoldersToIgnore: [],
    openRandomNote: false,
    autoNextNote: false,
    disableFileMenuReviewOptions: false,
    maxNDaysNotesReviewQueue: 365,
    // algorithm
    baseEase: 250,
    lapsesIntervalChange: 0.5,
    easyBonus: 1.3,
    maximumInterval: 36525,
    maxLinkFactor: 1.0,
    // logging
    showDebugMessages: false,
};

// https://github.com/mgmeyers/obsidian-kanban/blob/main/src/Settings.ts
let applyDebounceTimer = 0;
export function applySettingsUpdate(callback: () => void): void {
    clearTimeout(applyDebounceTimer);
    applyDebounceTimer = window.setTimeout(callback, 512);
}

export class SRSettingTab extends PluginSettingTab {
    private plugin: SRPlugin;

    constructor(app: App, plugin: SRPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createDiv().innerHTML = <h2>{t("SETTINGS_HEADER")}</h2>;

        containerEl.createDiv().innerHTML = t("CHECK_WIKI", {
            wiki_url: "https://github.com/st3v3nmw/obsidian-spaced-repetition/wiki",
        });

        new Setting(containerEl)
            .setName(t("FOLDERS_TO_IGNORE"))
            .setDesc(t("FOLDERS_TO_IGNORE_DESC"))
            .addTextArea((text) =>
                text
                    .setValue(this.plugin.data.settings.noteFoldersToIgnore.join("\n"))
                    .onChange((value) => {
                        applySettingsUpdate(async () => {
                            this.plugin.data.settings.noteFoldersToIgnore = value
                                .split(/\n+/)
                                .map((v) => v.trim())
                                .filter((v) => v);
                            await this.plugin.savePluginData();
                        });
                    })
            );

        containerEl.createDiv().innerHTML = <h3>{t("FLASHCARDS")}</h3>;

        // new Setting(containerEl)
        //     .setName(t("FLASHCARD_TAGS"))
        //     .setDesc(t("FLASHCARD_TAGS_DESC"))
        //     .addTextArea((text) =>
        //         text
        //             .setValue(this.plugin.data.settings.flashcardTags.join(" \n"))
        //             .onChange((value) => {
        //                 // applySettingsUpdate(async () => {
        //                 //     this.plugin.data.settings.flashcardTags = value
        //                 //         .split(/\n+/)
        //                 //         .map((v) => v.trim())
        //                 //         .filter((v) => v);
        //                 //     await this.plugin.savePluginData();
        //                 // });
        //             })
        //     );

        // new Setting(containerEl)
        //     .setName(t("FLASHCARD_EXCLUDE_TAGS"))
        //     .setDesc(t("FLASHCARD_EXCLUDE_TAGS_DESC"))
        //     .addTextArea((text) =>
        //         text
        //             .setValue(this.plugin.data.settings.excludeFlashcardTags.join("\n"))
        //             .onChange((value) => {
        //                 applySettingsUpdate(async () => {
        //                     this.plugin.data.settings.excludeFlashcardTags = value
        //                         .split(/\n+/)
        //                         .map((v) => v.trim())
        //                         .filter((v) => v);
        //                     await this.plugin.savePluginData();
        //                 });
        //             })
        //     );

        new Setting(containerEl)
            .setName("Reset cache")
            .setDesc("Reset cache")
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.lastSyncDate = "";
                        SRPlugin.deckTree = undefined;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("CONVERT_FOLDERS_TO_DECKS"))
            .setDesc(t("CONVERT_FOLDERS_TO_DECKS_DESC"))
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.data.settings.convertFoldersToDecks)
                    .onChange(async (value) => {
                        this.plugin.data.settings.convertFoldersToDecks = value;
                        await this.plugin.savePluginData();
                    })
            );

        new Setting(containerEl)
            .setName(t("INLINE_SCHEDULING_COMMENTS"))
            .setDesc(t("INLINE_SCHEDULING_COMMENTS_DESC"))
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.data.settings.cardCommentOnSameLine)
                    .onChange(async (value) => {
                        this.plugin.data.settings.cardCommentOnSameLine = value;
                        await this.plugin.savePluginData();
                    })
            );

        new Setting(containerEl)
            .setName(t("BURY_SIBLINGS_TILL_NEXT_DAY"))
            .setDesc(t("BURY_SIBLINGS_TILL_NEXT_DAY_DESC"))
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.data.settings.burySiblingCards)
                    .onChange(async (value) => {
                        this.plugin.data.settings.burySiblingCards = value;
                        await this.plugin.savePluginData();
                    })
            );

        new Setting(containerEl)
            .setName(t("SHOW_CARD_CONTEXT"))
            .setDesc(t("SHOW_CARD_CONTEXT_DESC"))
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.data.settings.showContextInCards)
                    .onChange(async (value) => {
                        this.plugin.data.settings.showContextInCards = value;
                        await this.plugin.savePluginData();
                    })
            );

        new Setting(containerEl)
            .setName(t("CARD_MODAL_HEIGHT_PERCENT"))
            .setDesc(t("CARD_MODAL_SIZE_PERCENT_DESC"))
            .addSlider((slider) =>
                slider
                    .setLimits(10, 100, 5)
                    .setValue(this.plugin.data.settings.flashcardHeightPercentage)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.data.settings.flashcardHeightPercentage = value;
                        await this.plugin.savePluginData();
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.flashcardHeightPercentage =
                            DEFAULT_SETTINGS.flashcardHeightPercentage;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("CARD_MODAL_WIDTH_PERCENT"))
            .setDesc(t("CARD_MODAL_SIZE_PERCENT_DESC"))
            .addSlider((slider) =>
                slider
                    .setLimits(10, 100, 5)
                    .setValue(this.plugin.data.settings.flashcardWidthPercentage)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.data.settings.flashcardWidthPercentage = value;
                        await this.plugin.savePluginData();
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.flashcardWidthPercentage =
                            DEFAULT_SETTINGS.flashcardWidthPercentage;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl).setName(t("FILENAME_OR_OPEN_FILE")).addToggle((toggle) =>
            toggle
                .setValue(this.plugin.data.settings.showFileNameInFileLink)
                .onChange(async (value) => {
                    this.plugin.data.settings.showFileNameInFileLink = value;
                    await this.plugin.savePluginData();
                })
        );

        new Setting(containerEl).setName(t("RANDOMIZE_CARD_ORDER")).addToggle((toggle) =>
            toggle
                .setValue(this.plugin.data.settings.randomizeCardOrder)
                .onChange(async (value) => {
                    this.plugin.data.settings.randomizeCardOrder = value;
                    await this.plugin.savePluginData();
                })
        );

        new Setting(containerEl).setName(t("CONVERT_HIGHLIGHTS_TO_CLOZES")).addToggle((toggle) =>
            toggle
                .setValue(this.plugin.data.settings.convertHighlightsToClozes)
                .onChange(async (value) => {
                    this.plugin.data.settings.convertHighlightsToClozes = value;
                    await this.plugin.savePluginData();
                })
        );

        new Setting(containerEl).setName(t("CONVERT_BOLD_TEXT_TO_CLOZES")).addToggle((toggle) =>
            toggle
                .setValue(this.plugin.data.settings.convertBoldTextToClozes)
                .onChange(async (value) => {
                    this.plugin.data.settings.convertBoldTextToClozes = value;
                    await this.plugin.savePluginData();
                })
        );

        new Setting(containerEl)
            .setName(t("INLINE_CARDS_SEPARATOR"))
            .setDesc(t("FIX_SEPARATORS_MANUALLY_WARNING"))
            .addText((text) =>
                text
                    .setValue(this.plugin.data.settings.singlelineCardSeparator)
                    .onChange((value) => {
                        applySettingsUpdate(async () => {
                            this.plugin.data.settings.singlelineCardSeparator = value;
                            await this.plugin.savePluginData();
                        });
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.singlelineCardSeparator =
                            DEFAULT_SETTINGS.singlelineCardSeparator;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("INLINE_REVERSED_CARDS_SEPARATOR"))
            .setDesc(t("FIX_SEPARATORS_MANUALLY_WARNING"))
            .addText((text) =>
                text
                    .setValue(this.plugin.data.settings.singlelineReversedCardSeparator)
                    .onChange((value) => {
                        applySettingsUpdate(async () => {
                            this.plugin.data.settings.singlelineReversedCardSeparator = value;
                            await this.plugin.savePluginData();
                        });
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.singlelineReversedCardSeparator =
                            DEFAULT_SETTINGS.singlelineReversedCardSeparator;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("MULTILINE_CARDS_SEPARATOR"))
            .setDesc(t("FIX_SEPARATORS_MANUALLY_WARNING"))
            .addText((text) =>
                text
                    .setValue(this.plugin.data.settings.multilineCardSeparator)
                    .onChange((value) => {
                        applySettingsUpdate(async () => {
                            this.plugin.data.settings.multilineCardSeparator = value;
                            await this.plugin.savePluginData();
                        });
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.multilineCardSeparator =
                            DEFAULT_SETTINGS.multilineCardSeparator;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("MULTILINE_REVERSED_CARDS_SEPARATOR"))
            .setDesc(t("FIX_SEPARATORS_MANUALLY_WARNING"))
            .addText((text) =>
                text
                    .setValue(this.plugin.data.settings.multilineReversedCardSeparator)
                    .onChange((value) => {
                        applySettingsUpdate(async () => {
                            this.plugin.data.settings.multilineReversedCardSeparator = value;
                            await this.plugin.savePluginData();
                        });
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.multilineReversedCardSeparator =
                            DEFAULT_SETTINGS.multilineReversedCardSeparator;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        containerEl.createDiv().innerHTML = <h3>{t("NOTES")}</h3>;

        new Setting(containerEl)
            .setName(t("TAGS_TO_REVIEW"))
            .setDesc(t("TAGS_TO_REVIEW_DESC"))
            .addTextArea((text) =>
                text
                    .setValue(this.plugin.data.settings.tagsToReview.join(" "))
                    .onChange((value) => {
                        applySettingsUpdate(async () => {
                            this.plugin.data.settings.tagsToReview = value.split(/\s+/);
                            await this.plugin.savePluginData();
                        });
                    })
            );

        new Setting(containerEl)
            .setName(t("OPEN_RANDOM_NOTE"))
            .setDesc(t("OPEN_RANDOM_NOTE_DESC"))
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.data.settings.openRandomNote)
                    .onChange(async (value) => {
                        this.plugin.data.settings.openRandomNote = value;
                        await this.plugin.savePluginData();
                    })
            );

        new Setting(containerEl).setName(t("AUTO_NEXT_NOTE")).addToggle((toggle) =>
            toggle.setValue(this.plugin.data.settings.autoNextNote).onChange(async (value) => {
                this.plugin.data.settings.autoNextNote = value;
                await this.plugin.savePluginData();
            })
        );

        new Setting(containerEl)
            .setName(t("DISABLE_FILE_MENU_REVIEW_OPTIONS"))
            .setDesc(t("DISABLE_FILE_MENU_REVIEW_OPTIONS_DESC"))
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.data.settings.disableFileMenuReviewOptions)
                    .onChange(async (value) => {
                        this.plugin.data.settings.disableFileMenuReviewOptions = value;
                        await this.plugin.savePluginData();
                    })
            );

        new Setting(containerEl)
            .setName(t("MAX_N_DAYS_REVIEW_QUEUE"))
            .addText((text) =>
                text
                    .setValue(this.plugin.data.settings.maxNDaysNotesReviewQueue.toString())
                    .onChange((value) => {
                        applySettingsUpdate(async () => {
                            const numValue: number = Number.parseInt(value);
                            if (!isNaN(numValue)) {
                                if (numValue < 1) {
                                    new Notice(t("MIN_ONE_DAY"));
                                    text.setValue(
                                        this.plugin.data.settings.maxNDaysNotesReviewQueue.toString()
                                    );
                                    return;
                                }

                                this.plugin.data.settings.maxNDaysNotesReviewQueue = numValue;
                                await this.plugin.savePluginData();
                            } else {
                                new Notice(t("VALID_NUMBER_WARNING"));
                            }
                        });
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.maxNDaysNotesReviewQueue =
                            DEFAULT_SETTINGS.maxNDaysNotesReviewQueue;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        containerEl.createDiv().innerHTML = <h3>{t("ALGORITHM")}</h3>;
        containerEl.createDiv().innerHTML = t("CHECK_ALGORITHM_WIKI", {
            algo_url:
                "https://github.com/st3v3nmw/obsidian-spaced-repetition/wiki/Spaced-Repetition-Algorithm",
        });

        new Setting(containerEl)
            .setName(t("BASE_EASE"))
            .setDesc(t("BASE_EASE_DESC"))
            .addText((text) =>
                text.setValue(this.plugin.data.settings.baseEase.toString()).onChange((value) => {
                    applySettingsUpdate(async () => {
                        const numValue: number = Number.parseInt(value);
                        if (!isNaN(numValue)) {
                            if (numValue < 130) {
                                new Notice(t("BASE_EASE_MIN_WARNING"));
                                text.setValue(this.plugin.data.settings.baseEase.toString());
                                return;
                            }

                            this.plugin.data.settings.baseEase = numValue;
                            await this.plugin.savePluginData();
                        } else {
                            new Notice(t("VALID_NUMBER_WARNING"));
                        }
                    });
                })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.baseEase = DEFAULT_SETTINGS.baseEase;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("LAPSE_INTERVAL_CHANGE"))
            .setDesc(t("LAPSE_INTERVAL_CHANGE_DESC"))
            .addSlider((slider) =>
                slider
                    .setLimits(1, 99, 1)
                    .setValue(this.plugin.data.settings.lapsesIntervalChange * 100)
                    .setDynamicTooltip()
                    .onChange(async (value: number) => {
                        this.plugin.data.settings.lapsesIntervalChange = value / 100;
                        await this.plugin.savePluginData();
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.lapsesIntervalChange =
                            DEFAULT_SETTINGS.lapsesIntervalChange;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("EASY_BONUS"))
            .setDesc(t("EASY_BONUS_DESC"))
            .addText((text) =>
                text
                    .setValue((this.plugin.data.settings.easyBonus * 100).toString())
                    .onChange((value) => {
                        applySettingsUpdate(async () => {
                            const numValue: number = Number.parseInt(value) / 100;
                            if (!isNaN(numValue)) {
                                if (numValue < 1.0) {
                                    new Notice(t("EASY_BONUS_MIN_WARNING"));
                                    text.setValue(
                                        (this.plugin.data.settings.easyBonus * 100).toString()
                                    );
                                    return;
                                }

                                this.plugin.data.settings.easyBonus = numValue;
                                await this.plugin.savePluginData();
                            } else {
                                new Notice(t("VALID_NUMBER_WARNING"));
                            }
                        });
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.easyBonus = DEFAULT_SETTINGS.easyBonus;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("MAX_INTERVAL"))
            .setDesc(t("MAX_INTERVAL_DESC"))
            .addText((text) =>
                text
                    .setValue(this.plugin.data.settings.maximumInterval.toString())
                    .onChange((value) => {
                        applySettingsUpdate(async () => {
                            const numValue: number = Number.parseInt(value);
                            if (!isNaN(numValue)) {
                                if (numValue < 1) {
                                    new Notice(t("MAX_INTERVAL_MIN_WARNING"));
                                    text.setValue(
                                        this.plugin.data.settings.maximumInterval.toString()
                                    );
                                    return;
                                }

                                this.plugin.data.settings.maximumInterval = numValue;
                                await this.plugin.savePluginData();
                            } else {
                                new Notice(t("VALID_NUMBER_WARNING"));
                            }
                        });
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.maximumInterval =
                            DEFAULT_SETTINGS.maximumInterval;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("MAX_LINK_CONTRIB"))
            .setDesc(t("MAX_LINK_CONTRIB_DESC"))
            .addSlider((slider) =>
                slider
                    .setLimits(0, 100, 1)
                    .setValue(this.plugin.data.settings.maxLinkFactor * 100)
                    .setDynamicTooltip()
                    .onChange(async (value: number) => {
                        this.plugin.data.settings.maxLinkFactor = value / 100;
                        await this.plugin.savePluginData();
                    })
            )
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        this.plugin.data.settings.maxLinkFactor = DEFAULT_SETTINGS.maxLinkFactor;
                        await this.plugin.savePluginData();
                        this.display();
                    });
            });

        containerEl.createDiv().innerHTML = <h3>{t("LOGGING")}</h3>;
        new Setting(containerEl).setName(t("DISPLAY_DEBUG_INFO")).addToggle((toggle) =>
            toggle.setValue(this.plugin.data.settings.showDebugMessages).onChange(async (value) => {
                this.plugin.data.settings.showDebugMessages = value;
                await this.plugin.savePluginData();
            })
        );
    }
}
