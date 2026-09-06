// Public app config. The Supabase publishable key is safe to expose; access is limited by row level security.
window.APP_CONFIG = {
  supabaseUrl: "https://swqhwoqgjgvzkdlrehjf.supabase.co",
  supabaseKey: "sb_publishable_GmyukorajlGdIZzdhFOR2A_0cmavhSn",
  people: [
    { id: "davit", name: "Davit", avatar: "img/avatar-davit.png", emails: ["davit.ierusalimski@gmail.com", "davit.muradyan@outlook.com"] },
    { id: "luis", name: "Luis", avatar: "img/avatar-luis.png", emails: ["luisgerardo.mtz@gmail.com"] },
  ],
  agent: {
    to: ["info@damesvanvermeer.nl"],
    cc: ["aranka@damesvanvermeer.nl", "luisgerardo.mtz@gmail.com", "davit.muradyan@outlook.com"],
    greeting: "Hi Eline, Aranka,",
  },
  weeklyTarget: 5,
  shortlistSheet: "",   // paste the Google Sheet URL here once created; shows up in settings
  version: "3.0",
};
