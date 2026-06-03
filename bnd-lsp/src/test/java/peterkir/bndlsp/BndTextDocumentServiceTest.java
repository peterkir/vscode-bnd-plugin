package peterkir.bndlsp;

import aQute.bnd.help.Syntax;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class BndTextDocumentServiceTest {

    @Test
    void syntaxHelpIsLoaded() {
        Map<String, Syntax> help = Syntax.HELP;
        assertNotNull(help, "Syntax.HELP must not be null");
        assertFalse(help.isEmpty(), "Syntax.HELP must not be empty");

        // Verify a well-known instruction is present
        assertTrue(help.containsKey("-buildpath"), "Syntax.HELP must contain -buildpath");

        // Verify a well-known header is present
        assertTrue(help.containsKey("Bundle-SymbolicName"),
                "Syntax.HELP must contain Bundle-SymbolicName");
    }

    @Test
    void serviceInitializesCompletionLists() {
        BndTextDocumentService service = new BndTextDocumentService();
        // Just verify it constructs without throwing
        assertNotNull(service);
    }
}
