import { min } from "moment";
import { CardType } from "src/scheduling";

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
): [CardType, string, number, string][] {
    let cardText = "";
    const cards: [CardType, string, number, string][] = [];
    let cardType: CardType | null = null;
    let lineNo = 0;
    let cardTag = "";
    const multilineRegex = new RegExp(`^[\\t ]*${escapeRegex(multilineCardSeparator)}`, "gm");
    const multilineRegexReversed = new RegExp(
        `^[\\t ]*${escapeRegex(multilineReversedCardSeparator)}`,
        "gm"
    );
    let indentOnCardSeparatorLineNumber: number | null = null;

    const lines: string[] = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
        // let indentSofar = Number.MAX_VALUE;
        // let indentCur = 0;
        // if (i > 0) {
        //     indentSofar = Math.min(getIndent(lines[i - 1]), indentSofar);
        // }
        // indentCur = getIndent(lines[i]);
        if (
            lines[i].length === 0 ||
            (indentOnCardSeparatorLineNumber !== null &&
                getIndent(lines[indentOnCardSeparatorLineNumber]) > getIndent(lines[i]))
        ) {
            if (cardType) {
                if (cardType === CardType.MultiLineBasic) {
                    const idx =
                        cardText.search(
                            new RegExp(
                                `\\n[^\\n]*\\n^[\\t ]*${escapeRegex(multilineCardSeparator)}`,
                                "gm"
                            )
                        ) + 1;
                    cardText = cardText.substring(idx);
                }
                cards.push([cardType, cardText, lineNo, cardTag]);
                cardType = null;
                cardTag = "";
            }

            cardText = "";
            indentOnCardSeparatorLineNumber = null;
            continue;
        } else if (lines[i].startsWith("<!--") && !lines[i].startsWith("<!--SR:")) {
            while (i + 1 < lines.length && !lines[i].includes("-->")) i++;
            i++;
            continue;
        }

        if (cardText.length > 0) {
            cardText += "\n";
        }
        cardText += lines[i];

        if (
            lines[i].includes(singlelineReversedCardSeparator) ||
            lines[i].includes(singlelineCardSeparator)
        ) {
            cardType = lines[i].includes(singlelineReversedCardSeparator)
                ? CardType.SingleLineReversed
                : CardType.SingleLineBasic;
            cardText = lines[i];
            lineNo = i;
            if (i + 1 < lines.length && lines[i + 1].startsWith("<!--SR:")) {
                cardText += "\n" + lines[i + 1];
                i++;
            }
            for (const tag of flashcardTags) {
                if (cardText.includes(tag)) {
                    cardTag = tag.replace(/^#/, "");
                    break;
                }
            }
            cards.push([cardType, cardText, lineNo, cardTag]);
            cardType = null;
            cardTag = "";
            cardText = "";
        } else if (
            cardType === null &&
            ((convertHighlightsToClozes && /==.*?==/gm.test(lines[i])) ||
                (convertBoldTextToClozes && /\*\*.*?\*\*/gm.test(lines[i])))
        ) {
            cardType = CardType.Cloze;
            for (const tag of flashcardTags) {
                if (cardText.includes(tag)) {
                    cardTag = tag.replace(/^#/, "");
                    break;
                }
            }
            lineNo = i;
        } else if (multilineRegex.test(lines[i])) {
            indentOnCardSeparatorLineNumber = i;
            cardType = CardType.MultiLineBasic;
            for (const tag of flashcardTags) {
                if (cardText.includes(tag)) {
                    cardTag = tag.replace(/^#/, "");
                    break;
                }
            }
            lineNo = i;
        } else if (multilineRegexReversed.test(lines[i])) {
            indentOnCardSeparatorLineNumber = i;
            cardType = CardType.MultiLineReversed;
            for (const tag of flashcardTags) {
                if (cardText.includes(tag)) {
                    cardTag = tag.replace(/^#/, "");
                    break;
                }
            }
            lineNo = i;
        } else if (lines[i].startsWith("```") || lines[i].startsWith("~~~")) {
            const codeBlockClose = lines[i].match(/`+|~+/)[0];
            while (i + 1 < lines.length && !lines[i + 1].startsWith(codeBlockClose)) {
                i++;
                cardText += "\n" + lines[i];
            }
            cardText += "\n" + codeBlockClose;
            i++;
        }
    }

    if (cardType && cardText) {
        cards.push([cardType, cardText, lineNo, cardTag]);
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
