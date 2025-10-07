import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// --- Config simples ---
const H1 = process.env.H1_SPARQL;
const H2 = process.env.H2_SPARQL;
const PORT = process.env.PORT;

// --- Jouet: "session" utilisateur ---
// On simule Bob, enquêteur dans study_A
function getUserFromRequest(req) {
  return {
    sub: "bob",
    studies: ["study_A"],
  };
}

// --- Politique ABAC ---
// Permit si intersection(user.studies, patient.studies) != vide
function isAllowed(userStudies, patientStudies) {
  return patientStudies.some((s) => userStudies.includes(s));
}

// --- Helpers SPARQL ---
async function select(sparqlEndpoint, query) {
  const res = await axios.post(
    sparqlEndpoint,
    query,
    { headers: { "Content-Type": "application/sparql-query", Accept: "application/sparql-results+json" } }
  );
  return res.data.results.bindings;
}

// Récupère toutes les (patient, age, has_image, studies[]) pour "jeunes avec imagerie"
function qYoungWithImaging(maxAge = 50) {
  return `
PREFIX ex: <http://example.org/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?patient ?age (GROUP_CONCAT(STR(?st);SEPARATOR="|") AS ?studies) ?img
WHERE {
  ?patient ex:has_age ?age ;
           ex:has_image ?img ;
           ex:partOf ?st .
  FILTER(xsd:int(?age) < ${maxAge})
}
GROUP BY ?patient ?age ?img
`;
}

// Récupère les studies d’un patient donné
function qPatientStudies(patientIri) {
  return `
PREFIX ex: <http://example.org/>
SELECT ?st WHERE { ${patientIri} ex:partOf ?st . }
`;
}

// ----------------- ROUTES -----------------

// Query 1 : "jeunes (<50) avec imagerie"
app.post("/q1", async (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const maxAge = Number(req.body?.maxAge || 50);

    // 1) interroger H1 et H2
    const [b1, b2] = await Promise.all([
      select(H1, qYoungWithImaging(maxAge)),
      select(H2, qYoungWithImaging(maxAge)),
    ]);

    // 2) normaliser les résultats
    const mapRows = (bindings, site) =>
      bindings.map((b) => ({
        patient: b.patient.value,
        age: Number(b.age.value),
        studies: b.studies.value.split("|"), // à partir du GROUP_CONCAT
        site,
      }));

    let rows = [...mapRows(b1, "H1"), ...mapRows(b2, "H2")];

    // 3) appliquer la politique ABAC
    rows = rows.filter((r) => isAllowed(user.studies, r.studies));

    // 4) format de sortie
    res.json({
      user,
      result: rows.map(({ patient, age, site }) => ({ patient, age, site })),
    });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "proxy_error", detail: e.message });
  }
});

// Query 2 : "donne-moi patient#3" (par IRI)
app.get("/patient/:id", async (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const id = req.params.id; // ex: "patient3"
    const iri = `http://example.org/${id}`;

    // On ne sait pas à l'avance si le patient est à H1 ou H2 → on tente H1 puis H2
    const trySite = async (endpoint, site) => {
      const rows = await select(endpoint, qPatientStudies(`<${iri}>`));
      if (rows.length === 0) return null; // patient pas ici
      const studies = rows.map((r) => r.st.value);
      return { site, patient: iri, studies };
    };

    let found = await trySite(H1, "H1");
    if (!found) found = await trySite(H2, "H2");
    if (!found) return res.json({ user, result: null, reason: "not_found" });

    // Politique ABAC
    if (!isAllowed(user.studies, found.studies)) {
      return res.status(403).json({
        user,
        result: null,
        reason: "deny_by_policy",
        patient: found.patient,
        site: found.site,
        patientStudies: found.studies,
      });
    }

    // Autorisé
    res.json({
      user,
      result: { patient: found.patient, site: found.site, patientStudies: found.studies },
    });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "proxy_error", detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
});