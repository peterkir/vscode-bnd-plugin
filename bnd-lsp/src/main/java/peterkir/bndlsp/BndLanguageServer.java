package peterkir.bndlsp;

import org.eclipse.lsp4j.CompletionOptions;
import org.eclipse.lsp4j.InitializeParams;
import org.eclipse.lsp4j.InitializeResult;
import org.eclipse.lsp4j.ServerCapabilities;
import org.eclipse.lsp4j.ServerInfo;
import org.eclipse.lsp4j.TextDocumentSyncKind;
import org.eclipse.lsp4j.services.LanguageClient;
import org.eclipse.lsp4j.services.LanguageClientAware;
import org.eclipse.lsp4j.services.LanguageServer;
import org.eclipse.lsp4j.services.TextDocumentService;
import org.eclipse.lsp4j.services.WorkspaceService;

import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * LSP4J-based language server for bnd files.
 */
public class BndLanguageServer implements LanguageServer, LanguageClientAware {

    static final String SERVER_VERSION = "0.1.0";

    private LanguageClient client;
    private final BndTextDocumentService textDocumentService;
    private final BndWorkspaceService workspaceService;

    public BndLanguageServer() {
        this.textDocumentService = new BndTextDocumentService();
        this.workspaceService = new BndWorkspaceService();
    }

    @Override
    public void connect(LanguageClient client) {
        this.client = client;
        this.textDocumentService.setClient(client);
    }

    @Override
    public CompletableFuture<InitializeResult> initialize(InitializeParams params) {
        ServerCapabilities capabilities = new ServerCapabilities();

        capabilities.setTextDocumentSync(TextDocumentSyncKind.Incremental);

        CompletionOptions completionOptions = new CompletionOptions();
        completionOptions.setResolveProvider(false);
        completionOptions.setTriggerCharacters(Arrays.asList("-", "$", "{", ":"));
        capabilities.setCompletionProvider(completionOptions);

        capabilities.setHoverProvider(Boolean.TRUE);

        ServerInfo serverInfo = new ServerInfo();
        serverInfo.setName("bnd-language-server");
        serverInfo.setVersion(SERVER_VERSION);

        InitializeResult result = new InitializeResult(capabilities);
        result.setServerInfo(serverInfo);

        return CompletableFuture.completedFuture(result);
    }

    @Override
    public CompletableFuture<Object> shutdown() {
        return CompletableFuture.completedFuture(null);
    }

    @Override
    public void exit() {
        System.exit(0);
    }

    @Override
    public TextDocumentService getTextDocumentService() {
        return textDocumentService;
    }

    @Override
    public WorkspaceService getWorkspaceService() {
        return workspaceService;
    }
}
