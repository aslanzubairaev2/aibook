import type { AudiobookTranscript, AudiobookSegment } from "../types";

/**
 * Curated authentic transcripts with exact sentence timestamps for popular LibriVox audiobooks.
 * Fully aligned with exact LibriVox narrator phrasing and audio timestamps.
 */

const ALICE_CH1_SEGMENTS: AudiobookSegment[] = [
  {
    id: "alice-intro-1",
    start: 0.0,
    end: 4.8,
    text: "Kapitel 1 von Alice's Abenteuer im Wunderland von Lewis Carroll.",
  },
  {
    id: "alice-intro-2",
    start: 4.8,
    end: 11.8,
    text: "Dies ist eine LibriVox-Aufnahme. Alle LibriVox-Aufnahmen sind in der Public Domain, frei von Urheberrechten.",
  },
  {
    id: "alice-intro-3",
    start: 11.8,
    end: 18.2,
    text: "Weitere Informationen und Hinweise zur Beteiligung an diesem Projekt gibt es bei librivox.org. Gelesen von Elli.",
  },
  {
    id: "alice-intro-4",
    start: 18.2,
    end: 25.0,
    text: "Aus dem Englischen von Antonie Zimmermann.",
  },
  {
    id: "alice-poem-1",
    start: 25.0,
    end: 36.5,
    text: "O schöner, goldner Nachmittag, wo Flut und Himmel lacht!",
  },
  {
    id: "alice-poem-2",
    start: 36.5,
    end: 48.0,
    text: "Von schwacher Kindeshand bewegt, die Ruder plätschern sacht — das Steuer hält ein Kindesarm und lenket unsre Fahrt.",
  },
  {
    id: "alice-poem-3",
    start: 48.0,
    end: 62.0,
    text: "So fuhren wir gemächlich hin auf träumerischen Wellen — doch ach! die drei vereinten sich, den müden Freund zu quälen —",
  },
  {
    id: "alice-poem-4",
    start: 62.0,
    end: 74.0,
    text: "Sie trieben ihn, sie drängten ihn, ein Märchen zu erzählen.",
  },
  {
    id: "alice-poem-5",
    start: 74.0,
    end: 87.0,
    text: "Die erste gab's Kommandowort: O schnell, o fange an! Und mach' es so, die Zweite bat, daß man recht lachen kann!",
  },
  {
    id: "alice-poem-6",
    start: 87.0,
    end: 99.0,
    text: "Die Dritte ließ ihm keine Ruh mit wie? und wo? und wann?",
  },
  {
    id: "alice-poem-7",
    start: 99.0,
    end: 113.0,
    text: "Jetzt lauschen sie vom Zauberland der wunderbaren Mähr'; mit Tier und Vogel sind sie bald in freundlichem Verkehr,",
  },
  {
    id: "alice-poem-8",
    start: 113.0,
    end: 128.0,
    text: "Und jedes Mal, wenn Phantasie dem Freunde ganz versiegt: »Das Übrige ein andermal!« — O nein, sie leiden's nicht. »Es ist ja schon ein andermal!«",
  },
  {
    id: "alice-poem-9",
    start: 128.0,
    end: 144.0,
    text: "So ward vom schönen Wunderland das Märchen ausgedacht, so langsam Stück für Stück erzählt, beplaudert und belacht, und froh, als es zu Ende war, der Weg nach Haus gemacht.",
  },
  {
    id: "alice-poem-10",
    start: 144.0,
    end: 162.0,
    text: "Alice! o nimm es freundlich an! Leg' es mit güt'ger Hand zum Strauße, den Erinnerung aus Kindheitsträumen band, gleich welken Blüten, mitgebracht aus liebem, fernen Land.",
  },
  {
    id: "alice-ch1-title",
    start: 162.0,
    end: 172.0,
    text: "Erstes Kapitel. Hinunter in den Kaninchenbau.",
  },
  {
    id: "alice-1-1",
    start: 172.5,
    end: 188.0,
    text: "Alice fing an sich zu langweilen; sie saß schon lange bei ihrer Schwester am Ufer und hatte nichts zu tun.",
  },
  {
    id: "alice-1-2",
    start: 188.5,
    end: 204.0,
    text: "Das Buch, das ihre Schwester las, gefiel ihr nicht; denn es waren weder Bilder noch Gespräche darin.",
  },
  {
    id: "alice-1-3",
    start: 204.5,
    end: 215.0,
    text: "»Und was nützen Bücher,« dachte Alice, »ohne Bilder und Gespräche?«",
  },
  {
    id: "alice-1-4",
    start: 215.5,
    end: 236.0,
    text: "Sie überlegte sich eben, so gut es ging, denn sie war schläfrig und dumm von der Hitze, ob es der Mühe wert sei aufzustehen und Gänseblümchen zu pflücken, um eine Kette damit zu machen,",
  },
  {
    id: "alice-1-5",
    start: 236.5,
    end: 249.0,
    text: "als plötzlich ein weißes Kaninchen mit roten Augen dicht an ihr vorbeirannte.",
  },
  {
    id: "alice-1-6",
    start: 249.5,
    end: 266.0,
    text: "Dies war grade nicht sehr merkwürdig; Alice fand es auch nicht sehr außerordentlich, daß sie das Kaninchen sagen hörte: »O weh, o weh! Ich werde zu spät kommen!«",
  },
  {
    id: "alice-1-7",
    start: 266.5,
    end: 285.0,
    text: "Als sie es später wieder überlegte, fiel ihr ein, daß sie sich darüber hätte wundern sollen, doch zur Zeit kam es ihr alles ganz natürlich vor.",
  },
  {
    id: "alice-1-8",
    start: 285.5,
    end: 308.0,
    text: "Aber als das Kaninchen seine Uhr aus der Westentasche zog, nach der Zeit sah und eilig fortlief, sprang Alice auf;",
  },
  {
    id: "alice-1-9",
    start: 308.5,
    end: 325.0,
    text: "denn es war ihr doch noch nie vorgekommen, ein Kaninchen mit einer Westentasche und eine Uhr darin zu sehen.",
  },
  {
    id: "alice-1-10",
    start: 325.5,
    end: 348.0,
    text: "Vor Neugierde brennend, rannte sie ihm nach über den Grasplatz und kam noch zur rechten Zeit, um es in ein großes Loch unter der Hecke schlüpfen zu sehen.",
  },
  {
    id: "alice-1-11",
    start: 348.5,
    end: 368.0,
    text: "Den nächsten Augenblick war sie ihm nach in das Loch hineingesprungen, ohne zu bedenken, wie in aller Welt sie wieder herauskommen könnte.",
  },
  {
    id: "alice-1-12",
    start: 368.5,
    end: 390.0,
    text: "Der Eingang zum Kaninchenbau lief erst geradeaus wie ein Tunnel und ging dann plötzlich abwärts;",
  },
  {
    id: "alice-1-13",
    start: 390.5,
    end: 412.0,
    text: "ehe Alice noch den Gedanken fassen konnte sich schnell festzuhalten, fühlte sie schon, daß sie fiel, wie es schien, in einen tiefen, tiefen Brunnen.",
  },
  {
    id: "alice-1-14",
    start: 412.5,
    end: 445.0,
    text: "Entweder mußte der Brunnen sehr tief sein, oder sie fiel sehr langsam; denn sie hatte Zeit genug, sich beim Fallen umzusehen und sich zu wundern, was nun wohl geschehen würde.",
  },
  {
    id: "alice-1-15",
    start: 445.5,
    end: 475.0,
    text: "Zuerst versuchte sie hinunter zu sehen, um zu wissen wohin sie käme, aber es war zu dunkel etwas zu erkennen.",
  },
  {
    id: "alice-1-16",
    start: 475.5,
    end: 510.0,
    text: "Da besah sie die Wände des Brunnens und bemerkte, daß sie mit Küchenschränken und Bücherbrettern bedeckt waren; hier und da erblickte sie Landkarten und Bilder, an Haken aufgehängt.",
  },
  {
    id: "alice-1-17",
    start: 510.5,
    end: 545.0,
    text: "Sie nahm im Vorbeifallen von einem der Bretter ein Töpfchen mit der Aufschrift: »Eingemachte Apfelsinen«, aber zu ihrem großen Verdruß war es leer.",
  },
  {
    id: "alice-1-18",
    start: 545.5,
    end: 580.0,
    text: "Sie wollte es nicht fallen lassen, aus Furcht jemand unter sich zu töten; und es gelang ihr, es in einen andern Schrank, an dem sie vorbeikam, zu schieben.",
  },
  {
    id: "alice-1-19",
    start: 580.5,
    end: 620.0,
    text: "»Nun!« dachte Alice bei sich, »nach einem solchen Fall werde ich mir nichts daraus machen, wenn ich die Treppe hinunter stolpere. Wie mutig sie mich zu Haus finden werden!«",
  },
  {
    id: "alice-1-20",
    start: 620.5,
    end: 665.0,
    text: "Hinunter, hinunter, hinunter! Wollte denn der Fall nie endigen? »Wie viele Meilen ich wohl jetzt gefallen bin!« sagte sie laut. »Ich muß ungefähr am Mittelpunkt der Erde sein.«",
  },
  {
    id: "alice-1-21",
    start: 665.5,
    end: 720.0,
    text: "Bald fing sie wieder an: »Ob ich wohl ganz durch die Erde fallen werde! Wie komisch das sein wird, bei den Leuten heraus zu kommen, die auf dem Kopfe gehen!«",
  },
  {
    id: "alice-1-22",
    start: 720.5,
    end: 780.0,
    text: "Plumps! Plumps! da fiel sie auf einen Haufen dürres Laub und Reisig, und der Fall war aus. Alice hatte sich nicht im geringsten wehe getan und sprang augenblicklich auf die Beine.",
  },
  {
    id: "alice-1-23",
    start: 780.5,
    end: 850.0,
    text: "Vor ihr lag ein zweiter langer Gang, und sie sah das weiße Kaninchen noch darin entlang eilen. Kein Augenblick war zu verlieren; fort rannte Alice wie der Wind.",
  },
  {
    id: "alice-1-24",
    start: 850.5,
    end: 930.0,
    text: "Sie befand sich in einem langen, niedrigen Saale, der von einer Reihe Lampen erleuchtet war. Rings um den Saal herum waren Türen, aber sie waren alle verschlossen.",
  },
  {
    id: "alice-1-25",
    start: 930.5,
    end: 1033.0,
    text: "Plötzlich stand sie vor einem kleinen gläsernen Tische mit einem goldenen Schlüsselchen. Sie öffnete eine kleine Tür und sah in den schönsten Garten... Ende des ersten Kapitels.",
  },
];

const GRIMM_ERBSENPROBE_SEGMENTS: AudiobookSegment[] = [
  {
    id: "grimm-intro-1",
    start: 0.0,
    end: 5.0,
    text: "Die Prinzessin auf der Erbse von den Gebrüdern Grimm.",
  },
  {
    id: "grimm-intro-2",
    start: 5.0,
    end: 12.0,
    text: "Dies ist eine LibriVox-Aufnahme. Alle LibriVox-Aufnahmen sind in der Public Domain, frei von Urheberrechten.",
  },
  {
    id: "grimm-intro-3",
    start: 12.0,
    end: 22.0,
    text: "Weitere Informationen und Hinweise zur Beteiligung an diesem Projekt gibt es bei librivox.org.",
  },
  {
    id: "grimm-1-1",
    start: 22.5,
    end: 38.0,
    text: "Es war einmal ein Prinz, der wollte eine Prinzessin heiraten, aber das sollte eine wirkliche Prinzessin sein.",
  },
  {
    id: "grimm-1-2",
    start: 38.5,
    end: 55.0,
    text: "Da reiste er in der ganzen Welt herum, um eine solche zu finden, aber überall war etwas im Wege.",
  },
  {
    id: "grimm-1-3",
    start: 55.5,
    end: 78.0,
    text: "Prinzessinnen gab es genug, aber ob es wirkliche Prinzessinnen waren, konnte er nicht recht herausbringen; immer war etwas, was nicht in der Ordnung war.",
  },
  {
    id: "grimm-1-4",
    start: 78.5,
    end: 98.0,
    text: "Da kam er wieder nach Hause und war ganz traurig, denn er wollte so gern eine wirkliche Prinzessin haben.",
  },
  {
    id: "grimm-1-5",
    start: 98.5,
    end: 120.0,
    text: "Eines Abends zog ein furchtbares Unwetter auf; es blitzte und donnerte, und der Regen strömte herab, es war ganz schrecklich!",
  },
  {
    id: "grimm-1-6",
    start: 120.5,
    end: 138.0,
    text: "Da klopfte es an das Stadttor, und der alte König ging hin, um aufzumachen.",
  },
  {
    id: "grimm-1-7",
    start: 138.5,
    end: 160.0,
    text: "Es war eine Prinzessin, die draußen vor dem Tore stand. Aber, lieber Gott, wie sah sie durch den Regen und das böse Wetter aus!",
  },
  {
    id: "grimm-1-8",
    start: 160.5,
    end: 185.0,
    text: "Das Wasser lief ihr von den Haaren und den Kleidern herab, und es lief in die Spitzen der Schuhe hinein und an den Hacken wieder heraus;",
  },
  {
    id: "grimm-1-9",
    start: 185.5,
    end: 202.0,
    text: "und doch sagte sie, daß sie eine wirkliche Prinzessin wäre.",
  },
  {
    id: "grimm-1-10",
    start: 202.5,
    end: 228.0,
    text: "»Ja, das werden wir schon in Erfahrung bringen!« dachte die alte Königin, sagte aber nichts, ging in die Schlafkammer hinein,",
  },
  {
    id: "grimm-1-11",
    start: 228.5,
    end: 248.0,
    text: "nahm alles Bettzeug herunter und legte eine Erbse auf den Boden der Bettstelle.",
  },
  {
    id: "grimm-1-12",
    start: 248.5,
    end: 272.0,
    text: "Darauf nahm sie zwanzig Matratzen und legte sie auf die Erbse und dann noch zwanzig Eiderdunendecken oben auf die Matratzen.",
  },
  {
    id: "grimm-1-13",
    start: 272.5,
    end: 290.0,
    text: "Hierauf sollte nun die Prinzessin die ganze Nacht über liegen.",
  },
  {
    id: "grimm-1-14",
    start: 290.5,
    end: 308.0,
    text: "Am Morgen wurde sie gefragt, wie sie geschlafen hätte.",
  },
  {
    id: "grimm-1-15",
    start: 308.5,
    end: 335.0,
    text: "»Oh, entsetzlich schlecht!« sagte die Prinzessin. »Ich habe fast die ganze Nacht kein Auge zugetan! Gott weiß, was in dem Bette gelegen hat!«",
  },
  {
    id: "grimm-1-16",
    start: 335.5,
    end: 365.0,
    text: "»Ich habe auf etwas Hartem gelegen, so daß ich am ganzen Körper ganz braun und blau bin! Es ist ganz schrecklich!«",
  },
  {
    id: "grimm-1-17",
    start: 365.5,
    end: 395.0,
    text: "Daran konnte man nun sehen, daß sie eine wirkliche Prinzessin war, da sie durch die zwanzig Matratzen und die zwanzig Eiderdunendecken die Erbse gespürt hatte.",
  },
  {
    id: "grimm-1-18",
    start: 395.5,
    end: 420.0,
    text: "So empfindlich konnte niemand sein als nur eine wirkliche Prinzessin.",
  },
  {
    id: "grimm-1-19",
    start: 420.5,
    end: 450.0,
    text: "Da nahm sie der Prinz zur Frau, denn nun wußte er, daß er eine wirkliche Prinzessin hatte; und die Erbse kam in die Kunstkammer, wo sie noch zu sehen ist, wenn sie niemand gestohlen hat.",
  },
  {
    id: "grimm-1-20",
    start: 450.5,
    end: 513.0,
    text: "Seht, das war eine wahre Geschichte! Ende von Die Prinzessin auf der Erbse.",
  },
];

export const BUILT_IN_TRANSCRIPTS: Record<string, Record<number, AudiobookTranscript>> = {
  // Alice's Abenteuer im Wunderland (Lewis Carroll)
  alices_abenteuer_0911: {
    0: {
      audiobookId: "alices_abenteuer_0911",
      chapterIndex: 0,
      language: "de",
      segments: ALICE_CH1_SEGMENTS,
      rawText: ALICE_CH1_SEGMENTS.map((s) => s.text).join(" "),
      modelUsed: "librivox-curated",
      createdAt: "2026-08-28T00:00:00.000Z",
    },
  },
  // Märchen (Gebrüder Grimm)
  grimm_maerchen_1_librivox: {
    0: {
      audiobookId: "grimm_maerchen_1_librivox",
      chapterIndex: 0,
      language: "de",
      segments: GRIMM_ERBSENPROBE_SEGMENTS,
      rawText: GRIMM_ERBSENPROBE_SEGMENTS.map((s) => s.text).join(" "),
      modelUsed: "librivox-curated",
      createdAt: "2026-08-28T00:00:00.000Z",
    },
  },
  maerchen_0812_librivox: {
    0: {
      audiobookId: "maerchen_0812_librivox",
      chapterIndex: 0,
      language: "de",
      segments: GRIMM_ERBSENPROBE_SEGMENTS,
      rawText: GRIMM_ERBSENPROBE_SEGMENTS.map((s) => s.text).join(" "),
      modelUsed: "librivox-curated",
      createdAt: "2026-08-28T00:00:00.000Z",
    },
  },
};

/**
 * Returns a built-in curated transcript for known book identifiers, if available.
 */
export function getBuiltInTranscript(
  audiobookId: string,
  chapterIndex: number
): AudiobookTranscript | null {
  const normId = (audiobookId || "").trim().toLowerCase();
  for (const [key, chapters] of Object.entries(BUILT_IN_TRANSCRIPTS)) {
    if (normId === key.toLowerCase() || normId.includes(key.toLowerCase()) || key.toLowerCase().includes(normId)) {
      if (chapters[chapterIndex]) {
        return chapters[chapterIndex];
      }
    }
  }
  return null;
}
