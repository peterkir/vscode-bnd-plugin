package peterkir.bndlsp;

import aQute.bnd.help.Syntax;
import org.eclipse.lsp4j.CompletionItem;
import org.eclipse.lsp4j.CompletionItemKind;
import org.eclipse.lsp4j.CompletionList;
import org.eclipse.lsp4j.CompletionParams;
import org.eclipse.lsp4j.DidChangeTextDocumentParams;
import org.eclipse.lsp4j.DidCloseTextDocumentParams;
import org.eclipse.lsp4j.DidOpenTextDocumentParams;
import org.eclipse.lsp4j.DidSaveTextDocumentParams;
import org.eclipse.lsp4j.Hover;
import org.eclipse.lsp4j.HoverParams;
import org.eclipse.lsp4j.MarkupContent;
import org.eclipse.lsp4j.MarkupKind;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;
import org.eclipse.lsp4j.TextDocumentContentChangeEvent;
import org.eclipse.lsp4j.jsonrpc.messages.Either;
import org.eclipse.lsp4j.services.LanguageClient;
import org.eclipse.lsp4j.services.TextDocumentService;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Handles LSP text document requests (completion, hover) for bnd files.
 *
 * <p>Uses {@link aQute.bnd.help.Syntax#HELP} as the canonical data source for
 * instruction and header metadata.
 */
public class BndTextDocumentService implements TextDocumentService {

    private static final Logger LOG = Logger.getLogger(BndTextDocumentService.class.getName());

    /** Pattern: inside an unclosed ${...} macro expression on the current line */
    private static final Pattern MACRO_PATTERN = Pattern.compile("\\$\\{[^}]*$");

    /** Pattern: at the start of a property line (partial word up to cursor) */
    private static final Pattern PROPERTY_LINE_PATTERN = Pattern.compile("^\\s*-?[a-zA-Z0-9._-]*$");

    /** Pattern for extracting a word at cursor position (allows -, _, .) */
    private static final Pattern WORD_PATTERN = Pattern.compile("([-\\w.]+)");

    // Pre-computed completion lists built from Syntax.HELP at startup
    private final List<CompletionItem> instructionCompletions;
    private final List<CompletionItem> headerCompletions;

    // In-memory document store: uri -> full text
    private final Map<String, String[]> documents = new ConcurrentHashMap<>();

    @SuppressWarnings("unused")
    private LanguageClient client;

    public BndTextDocumentService() {
        List<CompletionItem> instructions = new ArrayList<>();
        List<CompletionItem> headers = new ArrayList<>();

        for (Map.Entry<String, Syntax> entry : Syntax.HELP.entrySet()) {
            String key = entry.getKey();
            Syntax syntax = entry.getValue();

            String detail = syntax.getLead() != null ? syntax.getLead() : key;
            String insert = syntax.getInsert() != null ? syntax.getInsert() : key;
            String docs = buildDocumentation(syntax);

            if (key.startsWith("-")) {
                CompletionItem item = new CompletionItem(key);
                item.setKind(CompletionItemKind.Property);
                item.setDetail(detail);
                item.setDocumentation(new MarkupContent(MarkupKind.MARKDOWN, docs));
                item.setInsertText(insert);
                item.setSortText("a_" + key);
                instructions.add(item);
            } else {
                CompletionItem item = new CompletionItem(key);
                item.setKind(CompletionItemKind.Field);
                item.setDetail(detail);
                item.setDocumentation(new MarkupContent(MarkupKind.MARKDOWN, docs));
                item.setInsertText(insert);
                item.setSortText("b_" + key);
                headers.add(item);
            }
        }

        this.instructionCompletions = Collections.unmodifiableList(instructions);
        this.headerCompletions = Collections.unmodifiableList(headers);

        LOG.info(String.format("bnd-lsp: loaded %d instructions, %d headers from Syntax.HELP",
                instructions.size(), headers.size()));
    }

    void setClient(LanguageClient client) {
        this.client = client;
    }

    // ─── Document sync ────────────────────────────────────────────────────────

    @Override
    public void didOpen(DidOpenTextDocumentParams params) {
        String uri = params.getTextDocument().getUri();
        String text = params.getTextDocument().getText();
        documents.put(uri, splitLines(text));
    }

    @Override
    public void didChange(DidChangeTextDocumentParams params) {
        String uri = params.getTextDocument().getUri();
        List<TextDocumentContentChangeEvent> changes = params.getContentChanges();
        if (changes.isEmpty()) { return; }

        // For simplicity use the last full-text change if present; otherwise apply incrementally
        TextDocumentContentChangeEvent last = changes.get(changes.size() - 1);
        if (last.getRange() == null) {
            // Full document update
            documents.put(uri, splitLines(last.getText()));
        } else {
            // Incremental update — apply each change in order
            String[] lines = documents.getOrDefault(uri, new String[0]);
            for (TextDocumentContentChangeEvent change : changes) {
                lines = applyChange(lines, change);
            }
            documents.put(uri, lines);
        }
    }

    @Override
    public void didClose(DidCloseTextDocumentParams params) {
        documents.remove(params.getTextDocument().getUri());
    }

    @Override
    public void didSave(DidSaveTextDocumentParams params) {
        // nothing to do
    }

    // ─── Completion ──────────────────────────────────────────────────────────

    @Override
    public CompletableFuture<Either<List<CompletionItem>, CompletionList>> completion(CompletionParams params) {
        String uri = params.getTextDocument().getUri();
        String[] lines = documents.getOrDefault(uri, new String[0]);
        int lineNum = params.getPosition().getLine();
        int col = params.getPosition().getCharacter();

        String lineUpToCursor = "";
        if (lineNum < lines.length) {
            String fullLine = lines[lineNum];
            lineUpToCursor = fullLine.substring(0, Math.min(col, fullLine.length()));
        }

        List<CompletionItem> result = new ArrayList<>();

        // Inside ${...} macro → not supported in v1; return empty
        if (MACRO_PATTERN.matcher(lineUpToCursor).find()) {
            return CompletableFuture.completedFuture(Either.forLeft(result));
        }

        // At start of property line → offer instructions + headers
        if (PROPERTY_LINE_PATTERN.matcher(lineUpToCursor).matches()) {
            result.addAll(instructionCompletions);
            result.addAll(headerCompletions);
        }

        return CompletableFuture.completedFuture(Either.forLeft(result));
    }

    // ─── Hover ───────────────────────────────────────────────────────────────

    @Override
    public CompletableFuture<Hover> hover(HoverParams params) {
        String uri = params.getTextDocument().getUri();
        String[] lines = documents.getOrDefault(uri, new String[0]);
        int lineNum = params.getPosition().getLine();
        int col = params.getPosition().getCharacter();

        if (lineNum >= lines.length) {
            return CompletableFuture.completedFuture(null);
        }

        String fullLine = lines[lineNum];
        String word = wordAtColumn(fullLine, col);
        if (word == null || word.isEmpty()) {
            return CompletableFuture.completedFuture(null);
        }

        // Look up: exact key, then try with leading "-"
        Syntax syntax = Syntax.HELP.get(word);
        if (syntax == null && !word.startsWith("-")) {
            syntax = Syntax.HELP.get("-" + word);
        }
        if (syntax == null) {
            return CompletableFuture.completedFuture(null);
        }

        String markdownContent = buildHoverContent(syntax);
        MarkupContent contents = new MarkupContent(MarkupKind.MARKDOWN, markdownContent);
        Hover hover = new Hover(contents);
        return CompletableFuture.completedFuture(hover);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private String buildDocumentation(Syntax syntax) {
        StringBuilder sb = new StringBuilder();
        if (syntax.getLead() != null) {
            sb.append(syntax.getLead());
        }
        String url = syntax.getHeader() != null ? autoHelpUrl(syntax.getHeader()) : null;
        if (url != null) {
            sb.append("\n\n[Documentation](").append(url).append(")");
        }
        return sb.toString();
    }

    private String buildHoverContent(Syntax syntax) {
        StringBuilder sb = new StringBuilder();
        if (syntax.getLead() != null) {
            sb.append("**").append(syntax.getLead()).append("**\n\n");
        }
        String example = syntax.getInsert();
        if (example != null && !example.isBlank()) {
            sb.append("\n\n**Example:**\n```bnd\n").append(example).append("\n```");
        }
        String url = syntax.getHeader() != null ? autoHelpUrl(syntax.getHeader()) : null;
        if (url != null) {
            sb.append("\n\n[Documentation](").append(url).append(")");
        }
        return sb.toString();
    }

    /**
     * Constructs the bnd documentation URL for a given header/instruction key.
     * Instructions (starting with "-") map to the _instructions path;
     * headers map to _heads; macros map to _macros.
     */
    private String autoHelpUrl(String key) {
        if (key == null || key.isBlank()) { return null; }
        String base = "https://bnd.bndtools.org";
        if (key.startsWith("-")) {
            return base + "/instructions/" + key.substring(1) + ".html";
        }
        // Could be a header or macro — link to headers for now
        return base + "/headers/" + key + ".html";
    }

    private String[] splitLines(String text) {
        // Split preserving empty trailing lines
        return text.split("\n", -1);
    }

    /**
     * Finds the word (matching {@link #WORD_PATTERN}) at the given column in a line.
     */
    private String wordAtColumn(String line, int col) {
        Matcher m = WORD_PATTERN.matcher(line);
        while (m.find()) {
            int start = m.start();
            int end = m.end();
            if (col >= start && col <= end) {
                return m.group(0);
            }
        }
        return null;
    }

    /**
     * Applies a single incremental text change to the in-memory line array.
     */
    private String[] applyChange(String[] lines, TextDocumentContentChangeEvent change) {
        Range range = change.getRange();
        if (range == null) {
            return splitLines(change.getText());
        }

        Position start = range.getStart();
        Position end = range.getEnd();

        // Build the new full text by reconstructing around the changed range
        StringBuilder sb = new StringBuilder();

        // Lines before start line
        for (int i = 0; i < start.getLine() && i < lines.length; i++) {
            sb.append(lines[i]).append("\n");
        }

        // Prefix of start line up to start character
        if (start.getLine() < lines.length) {
            String startLine = lines[start.getLine()];
            sb.append(startLine, 0, Math.min(start.getCharacter(), startLine.length()));
        }

        // Insert new text
        sb.append(change.getText());

        // Suffix of end line from end character
        if (end.getLine() < lines.length) {
            String endLine = lines[end.getLine()];
            if (end.getCharacter() < endLine.length()) {
                sb.append(endLine.substring(end.getCharacter()));
            }
        }

        // Lines after end line
        for (int i = end.getLine() + 1; i < lines.length; i++) {
            sb.append("\n").append(lines[i]);
        }

        return splitLines(sb.toString());
    }
}
