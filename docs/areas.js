// Amsterdam postcode (first four digits) to neighbourhood. Coarse but good enough for a card.
window.AREAS = {
  1011:"Nieuwmarkt / Lastage",1012:"Centrum (Burgwallen)",1013:"Haarlemmerbuurt / Westelijke Eilanden",1014:"Westpoort",
  1015:"Jordaan (Noord)",1016:"Jordaan / Grachtengordel-West",1017:"Grachtengordel-Zuid / Leidsebuurt",1018:"Plantage / Kadijken",
  1019:"Oostelijk Havengebied",1021:"Noord (Buiksloot)",1022:"Noord (Nieuwendam)",1023:"Noord (Schellingwoude)",
  1024:"Noord (Nieuwendam-Noord)",1025:"Noord (Buikslotermeer)",1031:"Noord (Overhoeks / NDSM)",1032:"Noord (Volewijck)",
  1033:"Noord (Tuindorp Oostzaan)",1034:"Noord (Banne)",1035:"Noord (Molenwijk)",1036:"Noord (Kadoelen)",
  1051:"Staatsliedenbuurt",1052:"Frederik Hendrikbuurt",1053:"Da Costabuurt / Kinkerbuurt",1054:"Helmersbuurt / Vondelbuurt",
  1055:"Bos en Lommer",1056:"Bos en Lommer / Kolenkitbuurt",1057:"Oud-West (Overtoom)",1058:"Hoofddorppleinbuurt / Westlandgracht",
  1059:"Schinkelbuurt",1060:"Nieuw-West (Sloten)",1061:"Nieuw-West (Slotervaart)",1062:"Nieuw-West (Slotervaart)",
  1063:"Nieuw-West (Geuzenveld)",1064:"Nieuw-West (Slotermeer)",1065:"Nieuw-West (Slotervaart)",1066:"Nieuw-West (Osdorp)",
  1067:"Nieuw-West (Geuzenveld)",1068:"Nieuw-West (Osdorp)",1069:"Nieuw-West (Osdorp)",
  1071:"Oud-Zuid / Museumkwartier",1072:"De Pijp (Noord)",1073:"De Pijp (Zuid)",1074:"De Pijp (Oost)",
  1075:"Willemspark / Hoofddorpplein",1076:"Stadionbuurt / Apollobuurt",1077:"Apollobuurt / Beethovenstraat",1078:"Rivierenbuurt",
  1079:"Rivierenbuurt (Zuid)",1081:"Buitenveldert (Oost)",1082:"Buitenveldert (West)",1083:"Buitenveldert",
  1086:"IJburg (Steigereiland)",1087:"IJburg (Haveneiland)",1091:"Weesperzijde / Oosterparkbuurt",1092:"Oosterparkbuurt",
  1093:"Dapperbuurt",1094:"Indische Buurt (West)",1095:"Indische Buurt (Oost) / Zeeburg",1096:"Amstelkwartier / Omval",
  1097:"Watergraafsmeer (Middenmeer)",1098:"Watergraafsmeer (Betondorp)",
  1101:"Zuidoost (Amstel III)",1102:"Zuidoost (Bijlmer)",1103:"Zuidoost (Bijlmer)",1104:"Zuidoost (Bijlmer)",
  1106:"Zuidoost (Gein)",1107:"Zuidoost (Holendrecht)",1108:"Zuidoost (Reigersbos)",1109:"Zuidoost (Driemond)",
};
window.areaFor = function (postcode) {
  const k = String(postcode || "").replace(/\s/g, "").slice(0, 4);
  return window.AREAS[k] || "Amsterdam";
};
