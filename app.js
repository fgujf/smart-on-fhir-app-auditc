// SMART Context
FHIR.oauth2.ready().then(async client => {
  window.smartClient = client;
  let banner = "";

  if (client.patient && client.patient.id) {
    try {
      const patient = await client.patient.read();
      const name = (patient.name?.[0]?.given?.join(" ") || "") + " " + (patient.name?.[0]?.family || "");
      banner += `<b>Patient:</b> ${name} | <b>Gender:</b> ${patient.gender || "Unknown"} | <b>DOB:</b> ${patient.birthDate || "Unknown"}`;
      const saveBtn = document.getElementById('saveToEHRBtn');
      if (saveBtn) saveBtn.disabled = false;
    } catch {
      banner += "<b>Patient:</b> Unknown";
    }
  } else {
    banner += "<b>Patient:</b> No context";
  }

  try {
    const user = await client.user.read();
    const username = (user.name?.[0]?.given?.[0] || "") + " " + (user.name?.[0]?.family || "");
    banner += `<br><b>User:</b> ${username || user.id || "Unknown"} (${user.resourceType})`;
  } catch {
    banner += "<br><b>User:</b> Unknown";
  }

  const bannerEl = document.getElementById("contextBanner");
  if (bannerEl) bannerEl.innerHTML = banner;
}).catch(err => {
  console.error("SMART flow failed:", err);
  const bannerEl = document.getElementById("contextBanner");
  if (bannerEl) bannerEl.textContent = "Failed to load context.";
});

// --- Scoring functions ---
function calculateFastC() {
  const gender = document.getElementById('gender').value;
  const q1 = parseInt(document.getElementById('q1').value || 0);
  const q2 = parseInt(document.getElementById('q2').value || 0);
  const q3 = parseInt(document.getElementById('q3').value || 0);

  if (!gender || isNaN(q1) || isNaN(q2) || isNaN(q3)) {
    alert("Please answer gender and all questions in Section 1.");
    return;
  }

  const fastCScore = q1 + q2 + q3;
  document.getElementById('fastCScore').textContent = `FAST C Score: ${fastCScore}`;

  const section2 = document.getElementById('section2');
  const selects = section2.querySelectorAll('select');
  const threshold = (gender === 'female') ? 3 : 4;

  if (fastCScore >= threshold) {
    section2.classList.remove('disabled-section');
    selects.forEach(select => select.disabled = false);
  } else {
    section2.classList.add('disabled-section');
    selects.forEach(select => {
      select.disabled = true;
      select.selectedIndex = 0;
    });
    document.getElementById('totalAuditScore').textContent = "Total Audit Score: —";
    document.getElementById('riskSeverity').textContent = "";
    document.getElementById('riskSeverity').className = "result";
  }
}

function calculateAuditScore() {
  const ids = ['q1','q2','q3','q4','q5','q6','q7','q8','q9','q10'];
  let total = 0;
  for (let id of ids) {
    const val = parseInt(document.getElementById(id).value);
    if (isNaN(val)) {
      alert("Please answer all questions before calculating the score.");
      return;
    }
    total += val;
  }
  document.getElementById('totalAuditScore').textContent = `Total Audit Score: ${total}`;

  const risk = document.getElementById('riskSeverity');
  risk.className = "result";
  if (total <= 7) { risk.textContent = "Risk Level: Low Risk"; risk.classList.add("risk-low"); }
  else if (total <= 15) { risk.textContent = "Risk Level: Increasing Risk"; risk.classList.add("risk-increasing"); }
  else if (total <= 19) { risk.textContent = "Risk Level: Higher Risk"; risk.classList.add("risk-higher"); }
  else { risk.textContent = "Risk Level: Possible Dependence"; risk.classList.add("risk-dependence"); }
}

async function saveToEHR() {
  if (!window.smartClient) {
    alert("App not authorized. Launch this app from an EHR (or use the SMART sandbox).");
    return;
  }
  const client = window.smartClient;

  if (!client.patient || !client.patient.id) {
    alert("No patient context available. App must be launched from EHR with a patient selected.");
    return;
  }

  // Get Q1–Q3
  const q1 = parseInt(document.getElementById('q1').value);
  const q2 = parseInt(document.getElementById('q2').value);
  const q3 = parseInt(document.getElementById('q3').value);

  if (isNaN(q1) || isNaN(q2) || isNaN(q3)) {
    alert("Please answer Q1–Q3 before saving.");
    return;
  }

  const auditCScore = q1 + q2 + q3;

  // --- QuestionnaireResponse with only Q1–Q3 ---
  const qr = {
    resourceType: "QuestionnaireResponse",
    status: "completed",
    subject: { reference: `Patient/${client.patient.id}` },
    authored: new Date().toISOString(),
    item: [
      {
        linkId: "1",
        text: "How often do you have a drink containing alcohol?",
        answer: [{ valueInteger: q1 }]
      },
      {
        linkId: "2",
        text: "How many standard drinks containing alcohol do you have on a typical day?",
        answer: [{ valueInteger: q2 }]
      },
      {
        linkId: "3",
        text: "How often do you have 6 or more drinks on 1 occasion?",
        answer: [{ valueInteger: q3 }]
      }
    ]
  };

  try {
    const createdQR = await client.create(qr);

    // --- Observation Q1 ---
    const obsQ1 = {
      resourceType: "Observation",
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "68518-0", display: "How often do you have a drink containing alcohol?" }] },
      subject: { reference: `Patient/${client.patient.id}` },
      effectiveDateTime: new Date().toISOString(),
      valueInteger: q1,
      derivedFrom: [{ reference: `QuestionnaireResponse/${createdQR.id}` }]
    };

    // --- Observation Q2 ---
    const obsQ2 = {
      resourceType: "Observation",
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "68519-8", display: "How many standard drinks containing alcohol do you have on a typical day?" }] },
      subject: { reference: `Patient/${client.patient.id}` },
      effectiveDateTime: new Date().toISOString(),
      valueInteger: q2,
      derivedFrom: [{ reference: `QuestionnaireResponse/${createdQR.id}` }]
    };

    // --- Observation Q3 ---
    const obsQ3 = {
      resourceType: "Observation",
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "68520-6", display: "How often do you have 6 or more drinks on 1 occasion?" }] },
      subject: { reference: `Patient/${client.patient.id}` },
      effectiveDateTime: new Date().toISOString(),
      valueInteger: q3,
      derivedFrom: [{ reference: `QuestionnaireResponse/${createdQR.id}` }]
    };

    // --- Observation: AUDIT-C total (Q1–Q3) ---
    const obsAuditC = {
      resourceType: "Observation",
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "75626-2", display: "Total score [AUDIT-C]" }] },
      subject: { reference: `Patient/${client.patient.id}` },
      effectiveDateTime: new Date().toISOString(),
      valueInteger: auditCScore,
      derivedFrom: [{ reference: `QuestionnaireResponse/${createdQR.id}` }]
    };

    // Save all Observations
    const [createdObsQ1, createdObsQ2, createdObsQ3, createdObsAuditC] = await Promise.all([
      client.create(obsQ1),
      client.create(obsQ2),
      client.create(obsQ3),
      client.create(obsAuditC)
    ]);

    alert(`Saved to EHR:\n- QuestionnaireResponse id: ${createdQR.id}\n- Q1 (68518-0) = ${q1}\n- Q2 (68519-8) = ${q2}\n- Q3 (68520-6) = ${q3}\n- AUDIT-C Score (75626-2) = ${auditCScore}`);

  } catch (err) {
    console.error("Failed to save resources:", err);
    alert("Save to EHR failed (see console).");
  }
}

// Expose functions for inline handlers
window.calculateFastC = calculateFastC;
window.calculateAuditScore = calculateAuditScore;
window.saveToEHR = saveToEHR;
