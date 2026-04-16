import {
    CompletionItem,
    CompletionItemKind,
    createConnection,
    Hover,
    InitializeParams,
    InitializeResult,
    InsertTextFormat,
    MarkupContent,
    MarkupKind,
    ProposedFeatures,
    TextDocumentPositionParams,
    TextDocuments,
    TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HEADERS, INSTRUCTIONS, MACROS } from './bndData';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => ({
    capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
            resolveProvider: false,
            triggerCharacters: ['-', '$', '{', ':'],
        },
        hoverProvider: true,
    },
    serverInfo: {
        name: 'bnd-language-server',
        version: '0.2.0',
    },
}));

// ─── Completion ────────────────────────────────────────────────────────────

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) { return []; }

    const line = doc.getText({
        start: { line: params.position.line, character: 0 },
        end: params.position,
    });

    // Inside a ${...} macro expression → offer macros
    if (/\$\{[^}]*$/.test(line)) {
        return MACROS.map(m => ({
            label: m.label,
            kind: CompletionItemKind.Function,
            detail: m.detail,
            documentation: markdownDoc(m.documentation),
            // insertText completes just the inner part; the ${...} wrapper is already there
            insertText: m.insertText,
            insertTextFormat: InsertTextFormat.PlainText,
        }));
    }

    // At the start of a new line (possibly with partial word) → offer instructions + headers
    if (/^\s*-?[a-zA-Z0-9._-]*$/.test(line)) {
        const items: CompletionItem[] = [];

        for (const instr of INSTRUCTIONS) {
            // Offer a plain completion (full line) and a snippet with example value
            items.push({
                label: instr.label,
                kind: CompletionItemKind.Property,
                detail: instr.detail,
                documentation: markdownDoc(instr.documentation),
                insertText: `${instr.insertText}`,
                insertTextFormat: InsertTextFormat.PlainText,
                sortText: `a_${instr.label}`,
            });
        }

        for (const header of HEADERS) {
            items.push({
                label: header.label,
                kind: CompletionItemKind.Field,
                detail: header.detail,
                documentation: markdownDoc(header.documentation),
                insertText: `${header.insertText}`,
                insertTextFormat: InsertTextFormat.PlainText,
                sortText: `b_${header.label}`,
            });
        }

        return items;
    }

    return [];
});

// ─── Hover ─────────────────────────────────────────────────────────────────

connection.onHover((params: TextDocumentPositionParams): Hover | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) { return null; }

    const line = doc.getText({
        start: { line: params.position.line, character: 0 },
        end: { line: params.position.line, character: 1000 },
    });

    // Extract word at cursor position (allows -, ., _)
    const col = params.position.character;
    const wordMatch = line.matchAll(/([-\w.]+)/g);
    let word = '';
    for (const m of wordMatch) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        if (col >= start && col <= end) {
            word = m[0];
            break;
        }
    }
    if (!word) { return null; }

    // Normalise: instructions always start with -
    const instrWord = word.startsWith('-') ? word : `-${word}`;
    const instr = INSTRUCTIONS.find(i => i.label === instrWord || i.label === word);
    if (instr) {
        return hoverResult(instr.detail, instr.documentation, instr.insertText);
    }

    const header = HEADERS.find(h => h.label === word);
    if (header) {
        return hoverResult(header.detail, header.documentation, header.insertText);
    }

    const macro = MACROS.find(m => m.label === word);
    if (macro) {
        return hoverResult(macro.detail, macro.documentation, `\${${macro.insertText}}`);
    }

    return null;
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function markdownDoc(text: string): MarkupContent {
    return { kind: MarkupKind.Markdown, value: text };
}

function hoverResult(title: string, documentation: string, example: string): Hover {
    const exampleSection = example
        ? `\n\n**Example:**\n\`\`\`bnd\n${example}\n\`\`\``
        : '';
    return {
        contents: {
            kind: MarkupKind.Markdown,
            value: `**${title}**\n\n${documentation}${exampleSection}`,
        },
    };
}

documents.listen(connection);
connection.listen();
