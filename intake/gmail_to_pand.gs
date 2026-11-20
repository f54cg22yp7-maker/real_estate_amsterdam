/**
 * Pand intake. Runs inside the Gmail account that receives the Dames van Vermeer alerts.
 * Every 5 minutes it sends new alert emails to Pand and labels them "pand-sent".
 *
 * Setup (once, about 5 minutes):
 *   1. Open https://script.google.com while signed in to that Gmail, New project, paste this file.
 *   2. Project Settings > Script Properties > add INGEST_SECRET with the value Davit gives you.
 *   3. Select the function "install" in the toolbar, press Run, and approve the Gmail permission.
 * To stop: Triggers (clock icon) > delete the trigger.
 */
const ENDPOINT = "https://swqhwoqgjgvzkdlrehjf.supabase.co/functions/v1/ingest-email";
const QUERY = "from:damesvanvermeer.nl subject:zoekopdracht newer_than:60d -label:pand-sent";
const LABEL = "pand-sent";

function pushAlerts() {
  const secret = PropertiesService.getScriptProperties().getProperty("INGEST_SECRET");
  if (!secret) throw new Error("Set the INGEST_SECRET script property first.");
  const threads = GmailApp.search(QUERY, 0, 20);
  if (!threads.length) return;
  const messages = [];
  threads.forEach((t) => t.getMessages().forEach((m) => messages.push({
    received_at: m.getDate().toISOString(), body: m.getPlainBody(), html: m.getBody(),
  })));
  const res = UrlFetchApp.fetch(ENDPOINT, {
    method: "post", contentType: "application/json", headers: { "x-ingest-secret": secret },
    payload: JSON.stringify({ messages }), muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("Pand intake failed: " + res.getResponseCode() + " " + res.getContentText());
  const label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  threads.forEach((t) => t.addLabel(label));
  console.log(res.getContentText());
}

function install() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("pushAlerts").timeBased().everyMinutes(5).create();
  pushAlerts();
}
