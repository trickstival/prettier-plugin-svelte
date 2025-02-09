import { doc } from 'prettier';

function isASTNode(n) {
    return 'html' in n && 'tokens' in n;
}

function extractAttributes(html) {
    const extractAttributesRegex = /<[a-z]+\s*(.*?)>/i;
    const attributeRegex = /([^\s=]+)(?:=("|')(.*?)\2)?/gi;
    const [, attributesString] = html.match(extractAttributesRegex);
    const attrs = [];
    let match;
    while ((match = attributeRegex.exec(attributesString))) {
        const [all, name, quotes, value] = match;
        const attrStart = match.index;
        let valueNode;
        if (!value) {
            valueNode = true;
        }
        else {
            let valueStart = attrStart + name.length;
            if (quotes) {
                valueStart += 2;
            }
            valueNode = [
                {
                    type: 'Text',
                    data: value,
                    start: valueStart,
                    end: valueStart + value.length,
                },
            ];
        }
        attrs.push({
            type: 'Attribute',
            name,
            value: valueNode,
            start: attrStart,
            end: attrStart + all.length,
        });
    }
    return attrs;
}

function getText(node, options) {
    return options.originalText.slice(options.locStart(node), options.locEnd(node));
}

const options = {
    svelteSortOrder: {
        type: 'choice',
        default: 'scripts-styles-markup',
        description: 'Sort order for scripts, styles, and markup',
        choices: [
            { value: 'scripts-styles-markup' },
            { value: 'scripts-markup-styles' },
            { value: 'markup-styles-scripts' },
            { value: 'markup-scripts-styles' },
            { value: 'styles-markup-scripts' },
            { value: 'styles-scripts-markup' },
        ],
    },
    svelteStrictMode: {
        type: 'boolean',
        default: false,
        description: 'More strict HTML syntax: self-closed tags, quotes in attributes',
    },
    svelteBracketNewLine: {
        type: 'boolean',
        default: false,
        description: 'Put the `>` of a multiline element on a new line',
    },
};
const sortOrderSeparator = '-';
function parseSortOrder(sortOrder) {
    return sortOrder.split(sortOrderSeparator);
}

function snipTagContent(tagName, source, placeholder = '') {
    const regex = new RegExp(`[\s\n]*<${tagName}([^]*?)>([^]*?)<\/${tagName}>[\s\n]*`, 'gi');
    return source.replace(regex, (_, attributes, content) => {
        const encodedContent = Buffer.from(content).toString('base64');
        return `<${tagName}${attributes} ✂prettier:content✂="${encodedContent}">${placeholder}</${tagName}>`;
    });
}
function hasSnippedContent(text) {
    return text.includes('✂prettier:content✂');
}
function unsnipContent(text) {
    const regex = /(<\w+.*?)\s*✂prettier:content✂="(.*?)">.*?(?=<\/)/gi;
    return text.replace(regex, (_, start, encodedContent) => {
        const content = Buffer.from(encodedContent, 'base64').toString('utf8');
        return `${start}>${content}`;
    });
    return text;
}

const { concat, join, line, group, indent, dedent, softline, hardline, fill, breakParent, } = doc.builders;
// @see http://xahlee.info/js/html5_non-closing_tag.html
const SELF_CLOSING_TAGS = [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
];
function print(path, options$$1, print) {
    const n = path.getValue();
    if (!n) {
        return '';
    }
    if (isASTNode(n)) {
        const parts = [];
        const addParts = {
            scripts() {
                if (n.module) {
                    n.module.type = 'Script';
                    n.module.attributes = extractAttributes(getText(n.module, options$$1));
                    parts.push(path.call(print, 'module'));
                }
                if (n.instance) {
                    n.instance.type = 'Script';
                    n.instance.attributes = extractAttributes(getText(n.instance, options$$1));
                    parts.push(path.call(print, 'instance'));
                }
            },
            styles() {
                if (n.css) {
                    n.css.type = 'Style';
                    n.css.content.type = 'StyleProgram';
                    parts.push(path.call(print, 'css'));
                }
            },
            markup() {
                const htmlDoc = path.call(print, 'html');
                if (htmlDoc) {
                    parts.push(htmlDoc);
                }
            },
        };
        parseSortOrder(options$$1.svelteSortOrder).forEach(p => addParts[p]());
        return group(join(hardline, parts));
    }
    const [open, close] = options$$1.svelteStrictMode ? ['"{', '}"'] : ['{', '}'];
    const node = n;
    switch (node.type) {
        case 'Fragment':
            const children = node.children;
            if (children.length === 0 || children.every(isEmptyNode)) {
                return '';
            }
            return concat([printChildren(path, print, false), hardline]);
        case 'Text':
            if (isEmptyNode(node)) {
                return Object.assign({}, line, { 
                    /**
                     * A text node is considered lonely if it is in a group without other inline
                     * elements, such as the line breaks between otherwise consecutive HTML tags.
                     * Text nodes that are both empty and lonely are discarded unless they have at
                     * least one empty line (i.e. at least two linebreak sequences). This is to
                     * allow for flexible grouping of HTML tags in a particular indentation level,
                     * and is similar to how vanilla HTML is handled in Prettier core.
                     */
                    keepIfLonely: /\n\r?\s*\n\r?/.test(node.raw || node.data) });
            }
            /**
             * For non-empty text nodes each sequence of non-whitespace characters (effectively,
             * each "word") is joined by a single `line`, which will be rendered as a single space
             * until this node's current line is out of room, at which `fill` will break at the
             * most convienient instance of `line`.
             */
            return fill(join(line, (node.raw || node.data).split(/[\t\n\f\r ]+/)).parts);
        case 'Element':
        case 'InlineComponent':
        case 'Slot':
        case 'Window':
        case 'Head':
        case 'Title': {
            const isEmpty = node.children.every(child => isEmptyNode(child));
            const isSelfClosingTag = isEmpty &&
                (!options$$1.svelteStrictMode ||
                    node.type !== 'Element' ||
                    SELF_CLOSING_TAGS.indexOf(node.name) !== -1);
            return group(concat([
                '<',
                node.name,
                indent(group(concat([
                    node.type === 'InlineComponent' && node.expression
                        ? concat([
                            line,
                            'this=',
                            open,
                            printJS(path, print, 'expression'),
                            close,
                        ])
                        : '',
                    ...path.map(childPath => childPath.call(print), 'attributes'),
                    options$$1.svelteBracketNewLine
                        ? dedent(isSelfClosingTag ? line : softline)
                        : '',
                ]))),
                isSelfClosingTag ? `${options$$1.svelteBracketNewLine ? '' : ' '}/>` : '>',
                isEmpty ? '' : indent(printChildren(path, print)),
                isSelfClosingTag ? '' : concat(['</', node.name, '>']),
            ]));
        }
        case 'Options':
        case 'Body':
            return group(concat([
                '<',
                node.name,
                indent(group(concat(path.map(childPath => childPath.call(print), 'attributes')))),
                ' />',
            ]));
        case 'Identifier':
            return node.name;
        case 'Attribute': {
            const hasLoneMustacheTag = node.value !== true &&
                node.value.length === 1 &&
                node.value[0].type === 'MustacheTag';
            let isAttributeShorthand = node.value !== true &&
                node.value.length === 1 &&
                node.value[0].type === 'AttributeShorthand';
            // Convert a={a} into {a}
            if (hasLoneMustacheTag) {
                const expression = node.value[0].expression;
                isAttributeShorthand =
                    expression.type === 'Identifier' && expression.name === node.name;
            }
            if (isAttributeShorthand) {
                return concat([line, '{', node.name, '}']);
            }
            const def = [line, node.name];
            if (node.value !== true) {
                def.push('=');
                const quotes = !hasLoneMustacheTag || options$$1.svelteStrictMode;
                quotes && def.push('"');
                def.push(...path.map(childPath => childPath.call(print), 'value'));
                quotes && def.push('"');
            }
            return concat(def);
        }
        case 'MustacheTag':
            return concat(['{', printJS(path, print, 'expression'), '}']);
        case 'IfBlock': {
            const def = [
                '{#if ',
                printJS(path, print, 'expression'),
                '}',
                indent(printChildren(path, print)),
            ];
            if (node.else) {
                def.push(path.call(print, 'else'));
            }
            def.push('{/if}');
            return group(concat(def));
        }
        case 'ElseBlock': {
            // Else if
            const parent = path.getParentNode();
            if (node.children.length === 1 &&
                node.children[0].type === 'IfBlock' &&
                parent.type !== 'EachBlock') {
                const ifNode = node.children[0];
                const def = [
                    '{:else if ',
                    path.map(ifPath => printJS(path, print, 'expression'), 'children')[0],
                    '}',
                    indent(path.map(ifPath => printChildren(ifPath, print), 'children')[0]),
                ];
                if (ifNode.else) {
                    def.push(path.map(ifPath => ifPath.call(print, 'else'), 'children')[0]);
                }
                return group(concat(def));
            }
            return group(concat(['{:else}', indent(printChildren(path, print))]));
        }
        case 'EachBlock': {
            const def = [
                '{#each ',
                printJS(path, print, 'expression'),
                ' as ',
                printJS(path, print, 'context'),
            ];
            if (node.index) {
                def.push(', ', node.index);
            }
            if (node.key) {
                def.push(' (', printJS(path, print, 'key'), ')');
            }
            def.push('}', indent(printChildren(path, print)));
            if (node.else) {
                def.push(path.call(print, 'else'));
            }
            def.push('{/each}');
            return group(concat(def));
        }
        case 'AwaitBlock': {
            const hasPendingBlock = node.pending.children.length !== 0 && !node.pending.children.every(isEmptyNode);
            const hasCatchBlock = node.catch.children.length !== 0 && !node.catch.children.every(isEmptyNode);
            if (hasPendingBlock && hasCatchBlock) {
                return group(concat([
                    group(concat(['{#await ', printJS(path, print, 'expression'), '}'])),
                    indent(path.call(print, 'pending')),
                    group(concat(['{:then', node.value ? ' ' + node.value : '', '}'])),
                    indent(path.call(print, 'then')),
                    group(concat(['{:catch', node.error ? ' ' + node.error : '', '}'])),
                    indent(path.call(print, 'catch')),
                    '{/await}',
                ]));
            }
            if (hasPendingBlock) {
                return group(concat([
                    group(concat(['{#await ', printJS(path, print, 'expression'), '}'])),
                    indent(path.call(print, 'pending')),
                    group(concat(['{:then', node.value ? ' ' + node.value : '', '}'])),
                    indent(path.call(print, 'then')),
                    '{/await}',
                ]));
            }
            return group(concat([
                group(concat([
                    '{#await ',
                    printJS(path, print, 'expression'),
                    ' then ',
                    node.value ? node.value : '',
                    '}',
                ])),
                indent(path.call(print, 'then')),
                '{/await}',
            ]));
        }
        case 'ThenBlock':
        case 'PendingBlock':
        case 'CatchBlock':
            return printChildren(path, print);
        case 'EventHandler':
            return concat([
                line,
                'on:',
                node.name,
                node.modifiers && node.modifiers.length
                    ? concat(['|', join('|', node.modifiers)])
                    : '',
                node.expression
                    ? concat(['=', open, printJS(path, print, 'expression'), close])
                    : '',
            ]);
        case 'Binding':
            return concat([
                line,
                'bind:',
                node.name,
                node.expression.type === 'Identifier' && node.expression.name === node.name
                    ? ''
                    : concat(['=', open, printJS(path, print, 'expression'), close]),
            ]);
        case 'Class':
            return concat([
                line,
                'class:',
                node.name,
                node.expression.type === 'Identifier' && node.expression.name === node.name
                    ? ''
                    : concat(['=', open, printJS(path, print, 'expression'), close]),
            ]);
        case 'Let':
            return concat([
                line,
                'let:',
                node.name,
                // shorthand let directives have `null` expressions
                !node.expression ||
                    (node.expression.type === 'Identifier' && node.expression.name === node.name)
                    ? ''
                    : concat(['=', open, printJS(path, print, 'expression'), close]),
            ]);
        case 'DebugTag':
            return concat([
                '{@debug',
                node.identifiers.length > 0
                    ? concat([' ', join(', ', path.map(print, 'identifiers'))])
                    : '',
                '}',
            ]);
        case 'Ref':
            return concat([line, 'ref:', node.name]);
        case 'Comment': {
            let text = node.data;
            if (hasSnippedContent(text)) {
                text = unsnipContent(text);
            }
            return group(concat(['<!--', text, '-->']));
        }
        case 'Transition':
            const kind = node.intro && node.outro ? 'transition' : node.intro ? 'in' : 'out';
            return concat([
                line,
                kind,
                ':',
                node.name,
                node.modifiers && node.modifiers.length
                    ? concat(['|', join('|', node.modifiers)])
                    : '',
                node.expression
                    ? concat(['=', open, printJS(path, print, 'expression'), close])
                    : '',
            ]);
        case 'Action':
            return concat([
                line,
                'use:',
                node.name,
                node.expression
                    ? concat(['=', open, printJS(path, print, 'expression'), close])
                    : '',
            ]);
        case 'Animation':
            return concat([
                line,
                'animate:',
                node.name,
                node.expression
                    ? concat(['=', open, printJS(path, print, 'expression'), close])
                    : '',
            ]);
        case 'RawMustacheTag':
            return concat(['{@html ', printJS(path, print, 'expression'), '}']);
        case 'Spread':
            return concat([line, '{...', printJS(path, print, 'expression'), '}']);
    }
    console.log(JSON.stringify(node, null, 4));
    throw new Error('unknown node type: ' + node.type);
}
function isEmptyGroup(group) {
    if (group.length === 0) {
        return true;
    }
    if (group.length > 1) {
        return false;
    }
    const lonelyDoc = group[0];
    if (typeof lonelyDoc === 'string' || lonelyDoc.type !== 'line') {
        return false;
    }
    return !lonelyDoc.keepIfLonely;
}
/**
 * Due to how `String.prototype.split` works, `TextNode`s with leading whitespace will be printed
 * to a `Fill` that has two additional parts at the begnning: an empty string (`''`) and a `line`.
 * If such a `Fill` doc is present at the beginning of an inline node group, those additional parts
 * need to be removed to prevent additional whitespace at the beginning of the parent's inner
 * content or after a sibling block node (i.e. HTML tags).
 */
function trimLeft(group) {
    if (group.length === 0) {
        return;
    }
    const first = group[0];
    if (typeof first === 'string') {
        return;
    }
    if (first.type === 'line') {
        group.shift();
        return;
    }
    if (first.type !== 'fill') {
        return;
    }
    // find the index of the first part that isn't an empty string or a line
    const trimIndex = first.parts.findIndex(part => typeof part === 'string' ? part !== '' : part.type !== 'line');
    first.parts.splice(0, trimIndex);
}
/**
 * Due to how `String.prototype.split` works, `TextNode`s with trailing whitespace will be printed
 * to a `Fill` that has two additional parts at the end: a `line` and an empty string (`''`). If
 * such a `Fill` doc is present at the beginning of an inline node group, those additional parts
 * need to be removed to prevent additional whitespace at the end of the parent's inner content or
 * before a sibling block node (i.e. HTML tags).
 */
function trimRight(group) {
    if (group.length === 0) {
        return;
    }
    const last = group[group.length - 1];
    if (typeof last === 'string') {
        return;
    }
    if (last.type === 'line') {
        group.pop();
        return;
    }
    if (last.type !== 'fill') {
        return;
    }
    last.parts.reverse();
    // find the index of the first part that isn't an empty string or a line
    const trimIndex = last.parts.findIndex(part => typeof part === 'string' ? part !== '' : part.type !== 'line');
    last.parts.splice(0, trimIndex);
    last.parts.reverse();
}
function printChildren(path, print, surroundingLines = true) {
    const childDocs = [];
    let currentGroup = [];
    /**
     * Sequences of inline nodes (currently, `TextNode`s and `MustacheTag`s) are collected into
     * groups and printed as a single `Fill` doc so that linebreaks as a result of sibling block
     * nodes (currently, all HTML elements) don't cause those inline sequences to break
     * prematurely. This is particularly important for whitespace sensitivity, as it is often
     * desired to have text directly wrapping a mustache tag without additional whitespace.
     */
    function flush() {
        if (!isEmptyGroup(currentGroup)) {
            trimLeft(currentGroup);
            trimRight(currentGroup);
            childDocs.push(fill(currentGroup));
        }
        currentGroup = [];
    }
    path.each(childPath => {
        const childNode = childPath.getValue();
        const childDoc = childPath.call(print);
        if (isInlineNode(childNode)) {
            currentGroup.push(childDoc);
        }
        else {
            flush();
            childDocs.push(concat([breakParent, childDoc]));
        }
    }, 'children');
    flush();
    return concat([
        surroundingLines ? softline : '',
        join(hardline, childDocs),
        surroundingLines ? dedent(softline) : '',
    ]);
}
function printJS(path, print, name) {
    if (!name) {
        path.getValue().isJS = true;
        return path.call(print);
    }
    path.getValue()[name].isJS = true;
    return path.call(print, name);
}
function isInlineNode(node) {
    return node.type === 'Text' || node.type === 'MustacheTag';
}
function isEmptyNode(node) {
    return node.type === 'Text' && (node.raw || node.data).trim() === '';
}

const { builders: { concat: concat$1, hardline: hardline$1, group: group$1, indent: indent$1 }, utils: { removeLines }, } = doc;
function embed(path, print, textToDoc, options) {
    const node = path.getNode();
    if (node.isJS) {
        return removeLines(textToDoc(getText(node, options), {
            parser: expressionParser,
            singleQuote: true,
        }));
    }
    switch (node.type) {
        case 'Script':
            return embedTag('script', path, print, textToDoc, node);
        case 'Style':
            return embedTag('style', path, print, textToDoc, node);
        case 'Element': {
            if (node.name === 'script' || node.name === 'style') {
                return embedTag(node.name, path, print, textToDoc, node, true);
            }
        }
    }
    return null;
}
function expressionParser(text, parsers) {
    const ast = parsers.babylon(`(${text})`);
    return {
        type: 'File',
        program: ast.program.body[0].expression,
    };
}
function skipBlank(docs) {
    for (let i = docs.length - 1; i >= 0; i--) {
        const doc$$1 = docs[i];
        if (typeof doc$$1 !== 'string') {
            if (doc$$1.type === 'break-parent') {
                continue;
            }
        }
        return i;
    }
    return -1;
}
function nukeLastLine(doc$$1) {
    if (typeof doc$$1 === 'string') {
        return doc$$1;
    }
    switch (doc$$1.type) {
        case 'concat':
            const end = skipBlank(doc$$1.parts);
            if (end > -1) {
                return concat$1([
                    ...doc$$1.parts.slice(0, end),
                    nukeLastLine(doc$$1.parts[end]),
                    ...doc$$1.parts.slice(end + 1),
                ]);
            }
            break;
        case 'line':
            return '';
    }
    return doc$$1;
}
function embedTag(tag, path, print, textToDoc, node, inline) {
    const parser = tag === 'script' ? 'typescript' : 'css';
    const contentAttribute = node.attributes.find(n => n.name === '✂prettier:content✂');
    let content = '';
    if (contentAttribute &&
        Array.isArray(contentAttribute.value) &&
        contentAttribute.value.length > 0) {
        const encodedContent = contentAttribute.value[0].data;
        content = Buffer.from(encodedContent, 'base64').toString('utf-8');
    }
    node.attributes = node.attributes.filter(n => n !== contentAttribute);
    return group$1(concat$1([
        '<',
        tag,
        indent$1(group$1(concat$1(path.map(childPath => childPath.call(print), 'attributes')))),
        '>',
        indent$1(concat$1([hardline$1, nukeLastLine(textToDoc(content, { parser }))])),
        hardline$1,
        '</',
        tag,
        '>',
        inline ? '' : hardline$1,
    ]));
}

function locStart(node) {
    return node.start;
}
function locEnd(node) {
    return node.end;
}
const languages = [
    {
        name: 'svelte',
        parsers: ['svelte'],
        extensions: ['.svelte'],
    },
];
const parsers = {
    svelte: {
        parse: text => {
            try {
                return require(`svelte/compiler`).parse(text);
            }
            catch (err) {
                err.loc = {
                    start: err.start,
                    end: err.end,
                };
                delete err.start;
                delete err.end;
                throw err;
            }
        },
        preprocess: text => {
            text = snipTagContent('style', text);
            text = snipTagContent('script', text, '{}');
            return text.trim();
        },
        locStart,
        locEnd,
        astFormat: 'svelte-ast',
    },
};
const printers = {
    'svelte-ast': {
        print,
        embed,
    },
};

export { languages, parsers, printers, options };
//# sourceMappingURL=plugin.js.map
