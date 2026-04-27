package peterkir.bndlsp;

import org.eclipse.lsp4j.jsonrpc.Launcher;
import org.eclipse.lsp4j.launch.LSPLauncher;
import org.eclipse.lsp4j.services.LanguageClient;

import java.util.concurrent.Future;
import java.util.logging.Logger;

/**
 * Entry point for the bnd Language Server.
 *
 * <p>Run as: {@code java -jar bnd-lsp.jar [--stdio]}
 *
 * <p>The server communicates over stdin/stdout. All log output goes to stderr.
 */
public class BndLspLauncher {

    private static final Logger LOG = Logger.getLogger(BndLspLauncher.class.getName());

    public static void main(String[] args) throws Exception {
        // Redirect java.util.logging to stderr (never stdout)
        System.setProperty("org.slf4j.simpleLogger.logFile", "System.err");

        LOG.info("bnd Language Server starting...");

        BndLanguageServer server = new BndLanguageServer();

        Launcher<LanguageClient> launcher = LSPLauncher.createServerLauncher(
                server,
                System.in,
                System.out
        );

        LanguageClient client = launcher.getRemoteProxy();
        server.connect(client);

        Future<?> future = launcher.startListening();
        LOG.info("bnd Language Server listening on stdio");
        future.get();
    }
}
