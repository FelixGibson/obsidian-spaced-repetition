import { parse } from "src/parser";
import { CardType } from "src/scheduling";

const defaultArgs: [string, string, string, string, boolean, boolean, string[]] = [
    "::",
    ":::",
    "?",
    "??",
    true,
    true,
    ["#p"],
];

test("Test parsing of single line basic cards", () => {
    expect(parse("Question::Answer #p", ...defaultArgs)).toEqual([
        [CardType.SingleLineBasic, "Question::Answer #p", 0, "p"],
    ]);
    expect(parse("Question::Answer #p \n<!--SR:!2021-08-11,4,270-->", ...defaultArgs)).toEqual([
        [CardType.SingleLineBasic, "Question::Answer #p \n<!--SR:!2021-08-11,4,270-->", 0, "p"],
    ]);
    expect(parse("Question::Answer #p <!--SR:2021-08-11,4,270-->", ...defaultArgs)).toEqual([
        [CardType.SingleLineBasic, "Question::Answer #p <!--SR:2021-08-11,4,270-->", 0, "p"],
    ]);
    expect(parse("Some text before\nQuestion ::Answer #p", ...defaultArgs)).toEqual([
        [CardType.SingleLineBasic, "Question ::Answer #p", 1, "p"],
    ]);
    expect(parse("#Title\n\nQ1::A1 #p\nQ2:: A2 #c", ...defaultArgs)).toEqual([
        [CardType.SingleLineBasic, "Q1::A1 #p", 2, "p"],
        [CardType.SingleLineBasic, "Q2:: A2 #c", 3, ""],
    ]);
});

// test("Test parsing of single line reversed cards", () => {
//     expect(parse("Question:::Answer", ...defaultArgs)).toEqual([
//         [CardType.SingleLineReversed, "Question:::Answer", 0],
//     ]);
//     expect(parse("Some text before\nQuestion :::Answer", ...defaultArgs)).toEqual([
//         [CardType.SingleLineReversed, "Question :::Answer", 1],
//     ]);
//     expect(parse("#Title\n\nQ1:::A1\nQ2::: A2", ...defaultArgs)).toEqual([
//         [CardType.SingleLineReversed, "Q1:::A1", 2],
//         [CardType.SingleLineReversed, "Q2::: A2", 3],
//     ]);
// });

test("Test parsing of multi line basic cards", () => {
    expect(parse("Question #p\n?\nAnswer", ...defaultArgs)).toEqual([
        [CardType.MultiLineBasic, "Question #p\n?\nAnswer", 1, "p"],
    ]);
    expect(parse("Question #p\n?\nAnswer <!--SR:!2021-08-11,4,270-->", ...defaultArgs)).toEqual([
        [CardType.MultiLineBasic, "Question #p\n?\nAnswer <!--SR:!2021-08-11,4,270-->", 1, "p"],
    ]);
    expect(parse("Question #p\n?\nAnswer\n<!--SR:2021-08-11,4,270-->", ...defaultArgs)).toEqual([
        [CardType.MultiLineBasic, "Question #p\n?\nAnswer\n<!--SR:2021-08-11,4,270-->", 1, "p"],
    ]);
    expect(parse("Some text before\nQuestion #p\n?\nAnswer", ...defaultArgs)).toEqual([
        [CardType.MultiLineBasic, "Question #p\n?\nAnswer", 2, "p"],
    ]);
    expect(parse("Question #p\n?\nAnswer\nSome text after!", ...defaultArgs)).toEqual([
        [CardType.MultiLineBasic, "Question #p\n?\nAnswer\nSome text after!", 1, "p"],
    ]);
    expect(
        parse("#Title\n\nLine0\nQ1 #p\n?\nA1\nAnswerExtra\n\nQ2 #p\n?\nA2", ...defaultArgs)
    ).toEqual([
        [CardType.MultiLineBasic, "Q1 #p\n?\nA1\nAnswerExtra", 4, "p"],
        [CardType.MultiLineBasic, "Q2 #p\n?\nA2", 9, "p"],
    ]);
    expect(parse("Some text before\nQuestion #p\n\t?\n\tAnswer", ...defaultArgs)).toEqual([
        [CardType.MultiLineBasic, "Question #p\n\t?\n\tAnswer", 2, "p"],
    ]);
    expect(parse("Some text before\nQuestion #p\n ?\n Answer", ...defaultArgs)).toEqual([
        [CardType.MultiLineBasic, "Question #p\n ?\n Answer", 2, "p"],
    ]);
    expect(parse("Some text before\nQuestion #p\n\t ?\n\t Answer", ...defaultArgs)).toEqual([
        [CardType.MultiLineBasic, "Question #p\n\t ?\n\t Answer", 2, "p"],
    ]);
    expect(
        parse(
            "Some text before\nQuestion #p\n\t ?\n\t Answer\n\t  Ans2\n\t Ans3\n\tNot4\nNot5",
            ...defaultArgs
        )
    ).toEqual([
        [CardType.MultiLineBasic, "Question #p\n\t ?\n\t Answer\n\t  Ans2\n\t Ans3", 2, "p"],
    ]);
    expect(
        parse(
            "Some text before\nQuestion #p\n\t ?\n\tAnswer\n\t  Ans2\n\t Ans3\n\tNot4\nNot5",
            ...defaultArgs
        )
    ).toEqual([[CardType.MultiLineBasic, "Question #p\n\t ?", 2, "p"]]);
    expect(
        parse("Question #p\n\t ?\n\tAnswer\n\t  Ans2\n\t Ans3\n\tNot4\nNot5", ...defaultArgs)
    ).toEqual([[CardType.MultiLineBasic, "Question #p\n\t ?", 1, "p"]]);
    expect(
        parse(
            "- [[Option-doc]]\n- str-[doc](https://doc.rust-lang.org/std/primitive.str.html)  #p\n ?\n tip: 和Java常量池一样",
            ...defaultArgs
        )
    ).toEqual([
        [
            CardType.MultiLineBasic,
            "- str-[doc](https://doc.rust-lang.org/std/primitive.str.html)  #p\n ?\n tip: 和Java常量池一样",
            2,
            "p",
        ],
    ]);
    expect(
        parse(
            "- String-[doc](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)   3类 #c\n  x \n\t- ps: 分别是', '', \\`， 三种，其中第三种可以用来穿插表达式  <!--SR:!2022-04-29,2,248-->\n- JavaScript Modules-[doc](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) #p\n  ?\n\t- ps: 可以看那个example，已经讲得很明白了，就是浏览器原生支持module.那么这和standard的script有什么不同？？\n- ",
            ...defaultArgs
        )
    ).toEqual([
        [
            CardType.MultiLineBasic,
            "- JavaScript Modules-[doc](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) #p\n  ?\n\t- ps: 可以看那个example，已经讲得很明白了，就是浏览器原生支持module.那么这和standard的script有什么不同？？",
            4,
            "p",
        ],
    ]);
    expect(
        parse(
            "- module system, include: 4个点 #p\n   ?\n\t- ps: 注意一个细节，这4个feature应该是上层包含下一层，比如packages包含众多crates, crates包含众多modules， modules包含众多paths :: #p\n\t- ps: module应该和C++中的namespace有点像",
            ...defaultArgs
        )
    ).toEqual([
        [
            CardType.SingleLineBasic,
            "\t- ps: 注意一个细节，这4个feature应该是上层包含下一层，比如packages包含众多crates, crates包含众多modules， modules包含众多paths :: #p",
            2,
            "p",
        ],
        [
            CardType.MultiLineBasic,
            "- module system, include: 4个点 #p\n   ?\n\t- ps: 注意一个细节，这4个feature应该是上层包含下一层，比如packages包含众多crates, crates包含众多modules， modules包含众多paths :: #p\n\t- ps: module应该和C++中的namespace有点像",
            1,
            "p",
        ],
    ]);
    expect(
        parse(
            "- module system, include: 4个点 #p \n   ?\n\t- ps: 注意一个细节，这4个feature应该是上层包含下一层，比如packages包含众多crates, crates包含众多modules， modules包含众多paths #p\n\t  ?\n\t\t- this is close \n\t- ps: module应该和C++中的namespace有点像",
            ...defaultArgs
        )
    ).toEqual([
        [
            CardType.MultiLineBasic,
            "\t- ps: 注意一个细节，这4个feature应该是上层包含下一层，比如packages包含众多crates, crates包含众多modules， modules包含众多paths #p\n\t  ?\n\t\t- this is close ",
            3,
            "p",
        ],
        [
            CardType.MultiLineBasic,
            "- module system, include: 4个点 #p \n   ?\n\t- ps: 注意一个细节，这4个feature应该是上层包含下一层，比如packages包含众多crates, crates包含众多modules， modules包含众多paths #p\n\t  ?\n\t\t- this is close \n\t- ps: module应该和C++中的namespace有点像",
            1,
            "p",
        ],
    ]);
    expect(
        parse(
            "- This is Head One  #p \n   ?\n\t- This is Head Two #p\n\t  ?\n\t\t- This is Content",
            ...defaultArgs
        )
    ).toEqual([
        [CardType.MultiLineBasic, "\t- This is Head Two #p\n\t  ?\n\t\t- This is Content", 3, "p"],
        [
            CardType.MultiLineBasic,
            "- This is Head One  #p \n   ?\n\t- This is Head Two #p\n\t  ?\n\t\t- This is Content",
            1,
            "p",
        ],
    ]);
});

// test("Test parsing of multi line reversed cards", () => {
//     expect(parse("Question\n??\nAnswer", ...defaultArgs)).toEqual([
//         [CardType.MultiLineReversed, "Question\n??\nAnswer", 1],
//     ]);
//     expect(parse("Some text before\nQuestion\n??\nAnswer", ...defaultArgs)).toEqual([
//         [CardType.MultiLineReversed, "Some text before\nQuestion\n??\nAnswer", 2],
//     ]);
//     expect(parse("Question\n??\nAnswer\nSome text after!", ...defaultArgs)).toEqual([
//         [CardType.MultiLineReversed, "Question\n??\nAnswer\nSome text after!", 1],
//     ]);
//     expect(parse("#Title\n\nLine0\nQ1\n??\nA1\nAnswerExtra\n\nQ2\n??\nA2", ...defaultArgs)).toEqual(
//         [
//             [CardType.MultiLineReversed, "Line0\nQ1\n??\nA1\nAnswerExtra", 4],
//             [CardType.MultiLineReversed, "Q2\n??\nA2", 9],
//         ]
//     );
// });

// test("Test parsing of cloze cards", () => {
//     // ==highlights==
//     expect(parse("cloze ==deletion== test", ...defaultArgs)).toEqual([
//         [CardType.Cloze, "cloze ==deletion== test", 0],
//     ]);
//     expect(parse("cloze ==deletion== test\n<!--SR:2021-08-11,4,270-->", ...defaultArgs)).toEqual([
//         [CardType.Cloze, "cloze ==deletion== test\n<!--SR:2021-08-11,4,270-->", 0],
//     ]);
//     expect(parse("cloze ==deletion== test <!--SR:2021-08-11,4,270-->", ...defaultArgs)).toEqual([
//         [CardType.Cloze, "cloze ==deletion== test <!--SR:2021-08-11,4,270-->", 0],
//     ]);
//     expect(parse("==this== is a ==deletion==\n", ...defaultArgs)).toEqual([
//         [CardType.Cloze, "==this== is a ==deletion==", 0],
//     ]);
//     expect(
//         parse(
//             "some text before\n\na deletion on\nsuch ==wow==\n\n" +
//                 "many text\nsuch surprise ==wow== more ==text==\nsome text after\n\nHmm",
//             ...defaultArgs
//         )
//     ).toEqual([
//         [CardType.Cloze, "a deletion on\nsuch ==wow==", 3],
//         [CardType.Cloze, "many text\nsuch surprise ==wow== more ==text==\nsome text after", 6],
//     ]);
//     expect(parse("srdf ==", ...defaultArgs)).toEqual([]);
//     expect(parse("lorem ipsum ==p\ndolor won==", ...defaultArgs)).toEqual([]);
//     expect(parse("lorem ipsum ==dolor won=", ...defaultArgs)).toEqual([]);
//     // ==highlights== turned off
//     expect(parse("cloze ==deletion== test", "::", ":::", "?", "??", false, true)).toEqual([]);

//     // **bolded**
//     expect(parse("cloze **deletion** test", ...defaultArgs)).toEqual([
//         [CardType.Cloze, "cloze **deletion** test", 0],
//     ]);
//     expect(parse("cloze **deletion** test\n<!--SR:2021-08-11,4,270-->", ...defaultArgs)).toEqual([
//         [CardType.Cloze, "cloze **deletion** test\n<!--SR:2021-08-11,4,270-->", 0],
//     ]);
//     expect(parse("cloze **deletion** test <!--SR:2021-08-11,4,270-->", ...defaultArgs)).toEqual([
//         [CardType.Cloze, "cloze **deletion** test <!--SR:2021-08-11,4,270-->", 0],
//     ]);
//     expect(parse("**this** is a **deletion**\n", ...defaultArgs)).toEqual([
//         [CardType.Cloze, "**this** is a **deletion**", 0],
//     ]);
//     expect(
//         parse(
//             "some text before\n\na deletion on\nsuch **wow**\n\n" +
//                 "many text\nsuch surprise **wow** more **text**\nsome text after\n\nHmm",
//             ...defaultArgs
//         )
//     ).toEqual([
//         [CardType.Cloze, "a deletion on\nsuch **wow**", 3],
//         [CardType.Cloze, "many text\nsuch surprise **wow** more **text**\nsome text after", 6],
//     ]);
//     expect(parse("srdf **", ...defaultArgs)).toEqual([]);
//     expect(parse("lorem ipsum **p\ndolor won**", ...defaultArgs)).toEqual([]);
//     expect(parse("lorem ipsum **dolor won*", ...defaultArgs)).toEqual([]);
//     // **bolded** turned off
//     expect(parse("cloze **deletion** test", "::", ":::", "?", "??", true, false)).toEqual([]);

//     // both
//     expect(parse("cloze **deletion** test ==another deletion==!", ...defaultArgs)).toEqual([
//         [CardType.Cloze, "cloze **deletion** test ==another deletion==!", 0],
//     ]);
// });

// test("Test parsing of a mix of card types", () => {
//     expect(
//         parse(
//             "# Lorem Ipsum\n\nLorem ipsum dolor ==sit amet==, consectetur ==adipiscing== elit.\n" +
//                 "Duis magna arcu, eleifend rhoncus ==euismod non,==\nlaoreet vitae enim.\n\n" +
//                 "Fusce placerat::velit in pharetra gravida\n\n" +
//                 "Donec dapibus ullamcorper aliquam.\n??\nDonec dapibus ullamcorper aliquam.\n<!--SR:2021-08-11,4,270-->",
//             ...defaultArgs
//         )
//     ).toEqual([
//         [
//             CardType.Cloze,
//             "Lorem ipsum dolor ==sit amet==, consectetur ==adipiscing== elit.\n" +
//                 "Duis magna arcu, eleifend rhoncus ==euismod non,==\n" +
//                 "laoreet vitae enim.",
//             2,
//         ],
//         [CardType.SingleLineBasic, "Fusce placerat::velit in pharetra gravida", 6],
//         [
//             CardType.MultiLineReversed,
//             "Donec dapibus ullamcorper aliquam.\n??\nDonec dapibus ullamcorper aliquam.\n<!--SR:2021-08-11,4,270-->",
//             9,
//         ],
//     ]);
// });

// test("Test codeblocks", () => {
//     // no blank lines
//     expect(
//         parse(
//             "How do you ... Python?\n?\n" +
//                 "```\nprint('Hello World!')\nprint('Howdy?')\nlambda x: x[0]\n```",
//             ...defaultArgs
//         )
//     ).toEqual([
//         [
//             CardType.MultiLineBasic,
//             "How do you ... Python?\n?\n" +
//                 "```\nprint('Hello World!')\nprint('Howdy?')\nlambda x: x[0]\n```",
//             1,
//         ],
//     ]);

//     // with blank lines
//     expect(
//         parse(
//             "How do you ... Python?\n?\n" +
//                 "```\nprint('Hello World!')\n\n\nprint('Howdy?')\n\nlambda x: x[0]\n```",
//             ...defaultArgs
//         )
//     ).toEqual([
//         [
//             CardType.MultiLineBasic,
//             "How do you ... Python?\n?\n" +
//                 "```\nprint('Hello World!')\n\n\nprint('Howdy?')\n\nlambda x: x[0]\n```",
//             1,
//         ],
//     ]);

//     // general Markdown syntax
//     expect(
//         parse(
//             "Nested Markdown?\n?\n" +
//                 "````ad-note\n\n" +
//                 "```git\n" +
//                 "+ print('hello')\n" +
//                 "- print('world')\n" +
//                 "```\n\n" +
//                 "~~~python\n" +
//                 "print('hello world')\n" +
//                 "~~~\n" +
//                 "````",
//             ...defaultArgs
//         )
//     ).toEqual([
//         [
//             CardType.MultiLineBasic,
//             "Nested Markdown?\n?\n" +
//                 "````ad-note\n\n" +
//                 "```git\n" +
//                 "+ print('hello')\n" +
//                 "- print('world')\n" +
//                 "```\n\n" +
//                 "~~~python\n" +
//                 "print('hello world')\n" +
//                 "~~~\n" +
//                 "````",
//             1,
//         ],
//     ]);
// });

// test("Test not parsing cards in HTML comments", () => {
//     expect(
//         parse("<!--\nQuestion\n?\nAnswer <!--SR:!2021-08-11,4,270-->\n-->", ...defaultArgs)
//     ).toEqual([]);
//     expect(
//         parse(
//             "<!--\nQuestion\n?\nAnswer <!--SR:!2021-08-11,4,270-->\n\n<!--cloze ==deletion== test-->-->",
//             ...defaultArgs
//         )
//     ).toEqual([]);
//     expect(parse("<!--cloze ==deletion== test-->", ...defaultArgs)).toEqual([]);
//     expect(parse("<!--cloze **deletion** test-->", ...defaultArgs)).toEqual([]);
// });
