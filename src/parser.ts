import { min } from "moment";
import { CardType } from "src/scheduling";
const NO_TAG = "#no_tag";

/**
 * Returns flashcards found in `text`
 *
 * @param text - The text to extract flashcards from
 * @param singlelineCardSeparator - Separator for inline basic cards
 * @param singlelineReversedCardSeparator - Separator for inline reversed cards
 * @param multilineCardSeparator - Separator for multiline basic cards
 * @param multilineReversedCardSeparator - Separator for multiline basic card
 * @returns An array of [CardType, card text, line number, tag] tuples
 */
export function parse(
    text: string,
    singlelineCardSeparator: string,
    singlelineReversedCardSeparator: string,
    multilineCardSeparator: string,
    multilineReversedCardSeparator: string,
    convertHighlightsToClozes: boolean,
    convertBoldTextToClozes: boolean,
    flashcardTags: string[]
): [CardType, string, number, string[]][] {
    const cards: [CardType, string, number, string[]][] = [];
    const stack: {
        cardType: CardType | null;
        cardText: string;
        lineNo: number;
        cardTag: string[];
        indentOnCardSeparatorLineNumber: number | null;
    }[] = [];
    const multilineRegex = new RegExp(`^[\\t ]*${escapeRegex(multilineCardSeparator)}`, "gm");
    const multilineRegexReversed = new RegExp(
        `^[\\t ]*${escapeRegex(multilineReversedCardSeparator)}`,
        "gm"
    );
    if (stack.length === 0) {
        stack.push({
            cardType: null,
            cardText: "",
            lineNo: 0,
            cardTag: [],
            indentOnCardSeparatorLineNumber: null,
        });
    }
    const lines: string[] = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (
            lines[i].length === 0 ||
            (stack.length > 0 &&
                stack[stack.length - 1].indentOnCardSeparatorLineNumber !== null &&
                getIndent(lines[stack[stack.length - 1].indentOnCardSeparatorLineNumber]) >
                    getIndent(lines[i]))
        ) {
            if (stack.length > 0 && stack[stack.length - 1].cardType !== null) {
                if (stack[stack.length - 1].cardType === CardType.MultiLineBasic) {
                    const regexp = new RegExp(
                        `\\n[^\\n]*\\n^[\\t ]*${escapeRegex(multilineCardSeparator)}`,
                        "gm"
                    );
                    const idx = stack[stack.length - 1].cardText.search(regexp) + 1;
                    stack[stack.length - 1].cardText =
                        stack[stack.length - 1].cardText.substring(idx);
                }
                cards.push([
                    stack[stack.length - 1].cardType,
                    stack[stack.length - 1].cardText,
                    stack[stack.length - 1].lineNo,
                    stack[stack.length - 1].cardTag,
                ]);
                stack.pop();
                if (stack.length === 0) {
                    stack.push({
                        cardType: null,
                        cardText: "",
                        lineNo: 0,
                        cardTag: [],
                        indentOnCardSeparatorLineNumber: null,
                    });
                }
            }
        } else if (lines[i].startsWith("<!--") && !lines[i].startsWith("<!--SR:")) {
            while (i + 1 < lines.length && !lines[i].includes("-->")) i++;
            i++;
            continue;
        }

        for (let j = 0; j < stack.length; j++) {
            stack[j].cardText += "\n";
            stack[j].cardText += lines[i];
        }

        if (
            lines[i].includes(singlelineReversedCardSeparator) ||
            lines[i].includes(singlelineCardSeparator)
        ) {
            if (stack[stack.length - 1].cardType !== null) {
                stack.push({
                    cardType: null,
                    cardText: "",
                    lineNo: 0,
                    cardTag: [],
                    indentOnCardSeparatorLineNumber: null,
                });
            }
            stack[stack.length - 1].cardType = lines[i].includes(singlelineReversedCardSeparator)
                ? CardType.SingleLineReversed
                : CardType.SingleLineBasic;
            stack[stack.length - 1].cardText = lines[i];
            stack[stack.length - 1].lineNo = i;
            if (i + 1 < lines.length && lines[i + 1].startsWith("<!--SR:")) {
                stack[stack.length - 1].cardText += "\n" + lines[i + 1];
                i++;
            }
            for (const tag of flashcardTags) {
                const regexp = new RegExp(` ${escapeRegex(tag)}`, "gm");
                if (stack[stack.length - 1].cardText.search(regexp) !== -1) {
                    stack[stack.length - 1].cardTag.push(tag);
                }
            }
            if (stack[stack.length - 1].cardTag.length === 0) {
                stack[stack.length - 1].cardTag.push(NO_TAG);
            }
            cards.push([
                stack[stack.length - 1].cardType,
                stack[stack.length - 1].cardText,
                stack[stack.length - 1].lineNo,
                stack[stack.length - 1].cardTag,
            ]);
            stack.pop();
            if (stack.length === 0) {
                stack.push({
                    cardType: null,
                    cardText: "",
                    lineNo: 0,
                    cardTag: [],
                    indentOnCardSeparatorLineNumber: null,
                });
            }
        } else if (
            stack[stack.length - 1].cardType === null &&
            ((convertHighlightsToClozes && /==.*?==/gm.test(lines[i])) ||
                (convertBoldTextToClozes && /\*\*.*?\*\*/gm.test(lines[i])))
        ) {
            stack[stack.length - 1].cardType = CardType.Cloze;
            for (const tag of flashcardTags) {
                const regexp = new RegExp(` ${escapeRegex(tag)}`, "gm");
                if (stack[stack.length - 1].cardText.search(regexp) !== -1) {
                    stack[stack.length - 1].cardTag.push(tag);
                }
            }
            if (stack[stack.length - 1].cardTag.length === 0) {
                stack[stack.length - 1].cardTag.push(NO_TAG);
            }
            stack[stack.length - 1].lineNo = i;
        } else if (multilineRegex.test(lines[i])) {
            if (stack[stack.length - 1].cardType !== null) {
                stack.push({
                    cardType: null,
                    cardText: "",
                    lineNo: 0,
                    cardTag: [],
                    indentOnCardSeparatorLineNumber: null,
                });
                if (i > 0) {
                    stack[stack.length - 1].cardText = lines[i - 1] + "\n" + lines[i];
                }
            }
            stack[stack.length - 1].indentOnCardSeparatorLineNumber = i;
            stack[stack.length - 1].cardType = CardType.MultiLineBasic;
            let question = "";
            if (i > 0) {
                question = lines[i - 1];
            }
            for (const tag of flashcardTags) {
                const regexp = new RegExp(` ${escapeRegex(tag)}`, "gm");
                if (question.search(regexp) != -1) {
                    stack[stack.length - 1].cardTag.push(tag);
                }
            }
            if (stack[stack.length - 1].cardTag.length === 0) {
                stack[stack.length - 1].cardTag.push(NO_TAG);
            }
            stack[stack.length - 1].lineNo = i;
        } else if (multilineRegexReversed.test(lines[i])) {
            if (stack[stack.length - 1].cardType !== null) {
                stack.push({
                    cardType: null,
                    cardText: "",
                    lineNo: 0,
                    cardTag: [],
                    indentOnCardSeparatorLineNumber: null,
                });
            }
            stack[stack.length - 1].indentOnCardSeparatorLineNumber = i;
            stack[stack.length - 1].cardType = CardType.MultiLineReversed;
            let question = "";
            if (i > 0) {
                question = lines[i - 1];
            }
            for (const tag of flashcardTags) {
                const regexp = new RegExp(` ${escapeRegex(tag)}`, "gm");
                if (question.search(regexp) != -1) {
                    stack[stack.length - 1].cardTag.push(tag);
                }
            }
            if (stack[stack.length - 1].cardTag.length === 0) {
                stack[stack.length - 1].cardTag.push(NO_TAG);
            }
            stack[stack.length - 1].lineNo = i;
        } else if (lines[i].startsWith("```") || lines[i].startsWith("~~~")) {
            const codeBlockClose = lines[i].match(/`+|~+/)[0];
            while (i + 1 < lines.length && !lines[i + 1].startsWith(codeBlockClose)) {
                i++;
                stack[stack.length - 1].cardText += "\n" + lines[i];
            }
            stack[stack.length - 1].cardText += "\n" + codeBlockClose;
            i++;
        }
    }

    while (
        stack.length > 0 &&
        stack[stack.length - 1].cardType &&
        stack[stack.length - 1].cardText
    ) {
        if (stack[stack.length - 1].cardType === CardType.MultiLineBasic) {
            const regexp = new RegExp(
                `\\n[^\\n]*\\n^[\\t ]*${escapeRegex(multilineCardSeparator)}`,
                "gm"
            );
            const idx = stack[stack.length - 1].cardText.search(regexp) + 1;
            stack[stack.length - 1].cardText = stack[stack.length - 1].cardText.substring(idx);
        }
        cards.push([
            stack[stack.length - 1].cardType,
            stack[stack.length - 1].cardText,
            stack[stack.length - 1].lineNo,
            stack[stack.length - 1].cardTag,
        ]);
        stack.pop();
    }

    return cards;
}

export function escapeRegex(str: string): string {
    return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function getIndent(str: string): number {
    let indent = 0;
    while (str.startsWith("\t")) {
        indent += 4;
        str = str.substring(1);
    }
    while (str.startsWith(" ")) {
        indent++;
        str = str.substring(1);
    }
    return indent;
}
