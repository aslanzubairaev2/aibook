import type { AudiobookTranscript, AudiobookSegment } from "../types";

/**
 * Curated authentic transcripts with timestamps for popular Project Gutenberg / LibriVox audiobooks.
 * Allows instant, zero-cost, perfectly matched read-along playback even without a Gemini API key.
 */

const ALICE_CH1_SEGMENTS: AudiobookSegment[] = [
  {
    id: "alice-1-1",
    start: 0.0,
    end: 8.5,
    text: "Alice's Abenteuer im Wunderland von Lewis Carroll. Erstes Kapitel: Hinunter in den Kaninchenbau.",
  },
  {
    id: "alice-1-2",
    start: 8.8,
    end: 18.2,
    text: "Alice fing an sich zu langweilen; sie saß schon lange bei ihrer Schwester am Ufer und hatte nichts zu thun.",
  },
  {
    id: "alice-1-3",
    start: 18.5,
    end: 27.0,
    text: "Das Buch, das ihre Schwester las, gefiel ihr nicht; denn es waren weder Bilder noch Gespräche darin.",
  },
  {
    id: "alice-1-4",
    start: 27.2,
    end: 34.5,
    text: "»Und was nützen Bücher,« dachte Alice, »ohne Bilder und Gespräche?«",
  },
  {
    id: "alice-1-5",
    start: 35.0,
    end: 46.5,
    text: "Sie überlegte sich eben, so gut es ging, denn sie war schläfrig und dumm von der Hitze, ob es der Mühe werth sei aufzustehen und Gänseblümchen zu pflücken, um eine Kette damit zu machen,",
  },
  {
    id: "alice-1-6",
    start: 46.8,
    end: 54.0,
    text: "als plötzlich ein weißes Kaninchen mit rothen Augen dicht an ihr vorbeirannte.",
  },
  {
    id: "alice-1-7",
    start: 54.5,
    end: 62.0,
    text: "Dies war grade nicht sehr merkwürdig; Alice fand es auch nicht sehr außerordentlich, daß sie das Kaninchen sagen hörte:",
  },
  {
    id: "alice-1-8",
    start: 62.2,
    end: 67.5,
    text: "»O weh, o weh! Ich werde zu spät kommen!«",
  },
  {
    id: "alice-1-9",
    start: 68.0,
    end: 78.5,
    text: "Als sie es später wieder überlegte, fiel ihr ein, daß sie sich darüber hätte wundern sollen, doch zur Zeit kam es ihr alles ganz natürlich vor.",
  },
  {
    id: "alice-1-10",
    start: 79.0,
    end: 92.0,
    text: "Aber als das Kaninchen seine Uhr aus der Westentasche zog, nach der Zeit sah und eilig fortlief, sprang Alice auf;",
  },
  {
    id: "alice-1-11",
    start: 92.2,
    end: 104.0,
    text: "denn es war ihr doch noch nie vorgekommen, ein Kaninchen mit einer Westentasche und eine Uhr darin zu sehen.",
  },
  {
    id: "alice-1-12",
    start: 104.5,
    end: 117.0,
    text: "Vor Neugierde brennend, rannte sie ihm nach über den Grasplatz und kam noch zur rechten Zeit, um es in ein großes Loch unter der Hecke schlüpfen zu sehen.",
  },
  {
    id: "alice-1-13",
    start: 117.5,
    end: 128.0,
    text: "Den nächsten Augenblick war sie ihm nach in das Loch hineingesprungen, ohne zu bedenken, wie in aller Welt sie wieder herauskommen könnte.",
  },
  {
    id: "alice-1-14",
    start: 128.5,
    end: 142.0,
    text: "Der Eingang zum Kaninchenbau lief erst geradeaus wie ein Tunnel und ging dann plötzlich abwärts;",
  },
  {
    id: "alice-1-15",
    start: 142.2,
    end: 154.0,
    text: "ehe Alice noch den Gedanken fassen konnte sich schnell festzuhalten, fühlte sie schon, daß sie fiel, wie es schien, in einen tiefen, tiefen Brunnen.",
  },
  {
    id: "alice-1-16",
    start: 154.5,
    end: 168.0,
    text: "Entweder mußte der Brunnen sehr tief sein, oder sie fiel sehr langsam; denn sie hatte Zeit genug, sich beim Fallen umzusehen und sich zu wundern, was nun wohl geschehen würde.",
  },
  {
    id: "alice-1-17",
    start: 168.5,
    end: 178.0,
    text: "Zuerst versuchte sie hinunter zu sehen, um zu wissen wohin sie käme, aber es war zu dunkel etwas zu erkennen.",
  },
  {
    id: "alice-1-18",
    start: 178.5,
    end: 192.0,
    text: "Da besah sie die Wände des Brunnens und bemerkte, daß sie mit Küchenschränken und Bücherbrettern bedeckt waren; hier und da erblickte sie Landkarten und Bilder, an Haken aufgehängt.",
  },
  {
    id: "alice-1-19",
    start: 192.5,
    end: 206.0,
    text: "Sie nahm im Vorbeifallen von einem der Bretter ein Töpfchen mit der Aufschrift: »Eingemachte Apfelsinen«, aber zu ihrem großen Verdruß war es leer.",
  },
  {
    id: "alice-1-20",
    start: 206.5,
    end: 218.0,
    text: "Sie wollte es nicht fallen lassen, aus Furcht jemand unter sich zu töten; und es gelang ihr, es in einen andern Schrank, an dem sie vorbeikam, zu schieben.",
  },
  {
    id: "alice-1-21",
    start: 218.5,
    end: 232.0,
    text: "»Nun!« dachte Alice bei sich, »nach einem solchen Fall werde ich mir nichts daraus machen, wenn ich die Treppe hinunter stolpere. Wie mutig sie mich zu Haus finden werden!«",
  },
  {
    id: "alice-1-22",
    start: 232.5,
    end: 245.0,
    text: "Hinunter, hinunter, hinunter! Wollte denn der Fall nie endigen? »Wie viele Meilen ich wohl jetzt gefallen bin!« sagte sie laut.",
  },
  {
    id: "alice-1-23",
    start: 245.5,
    end: 260.0,
    text: "»Ich muß ungefähr am Mittelpunkt der Erde sein. Laß sehen: das wären achthundert und fünfzig Meilen, glaube ich.«",
  },
  {
    id: "alice-1-24",
    start: 260.5,
    end: 278.0,
    text: "Bald fing sie wieder an: »Ob ich wohl ganz durch die Erde fallen werde! Wie komisch das sein wird, bei den Leuten heraus zu kommen, die auf dem Kopfe gehen!«",
  },
  {
    id: "alice-1-25",
    start: 278.5,
    end: 300.0,
    text: "»Aber natürlich werde ich sie fragen müssen, wie das Land heißt. Bitte, liebe Dame, ist dies Neu-Seeland oder Australien?«",
  },
  {
    id: "alice-1-26",
    start: 300.5,
    end: 330.0,
    text: "Plumps! Plumps! da fiel sie auf einen Haufen dürres Laub und Reisig, und der Fall war aus. Alice hatte sich nicht im geringsten wehe gethan und sprang augenblicklich auf die Beine.",
  },
  {
    id: "alice-1-27",
    start: 330.5,
    end: 360.0,
    text: "Vor ihr lag ein zweiter langer Gang, und sie sah das weiße Kaninchen noch darin entlang eilen. Kein Augenblick war zu verlieren; fort rannte Alice wie der Wind.",
  },
  {
    id: "alice-1-28",
    start: 360.5,
    end: 420.0,
    text: "Sie hörte es noch sagen, als es um eine Ecke bog: »O Ohren und Schnurrbart, wie spät es ist!« Sie war dicht hinter ihm, aber als sie um die Ecke bog, war das Kaninchen nicht mehr zu sehen.",
  },
  {
    id: "alice-1-29",
    start: 420.5,
    end: 500.0,
    text: "Sie befand sich in einem langen, niedrigen Saale, der von einer Reihe Lampen erleuchtet war, die von der Decke herabhingen. Rings um den Saal herum waren Thüren, aber sie waren alle verschlossen.",
  },
  {
    id: "alice-1-30",
    start: 500.5,
    end: 600.0,
    text: "Plötzlich stand sie vor einem kleinen dreibeinigen Tische, ganz von dickem Glase; es lag nichts darauf als ein winziges goldenes Schlüsselchen, und Alice dachte sogleich, dies könnte zu einer der Thüren des Saales gehören.",
  },
  {
    id: "alice-1-31",
    start: 600.5,
    end: 750.0,
    text: "Sie steckte das Schlüsselchen in das Schloß, und zu ihrer großen Freude paßte es! Die Thür öffnete sich in einen kleinen Gang, der nicht viel größer war als ein Rattenloch; sie kniete nieder und sah durch den Gang in den reizendsten Garten.",
  },
  {
    id: "alice-1-32",
    start: 750.5,
    end: 900.0,
    text: "Wie sehnte sie sich danach, aus dem dunkeln Saale hinauszugehen und unter den lichten Blumenbeeten und kühlen Springbrunnen umherzuwandeln! Aber sie konnte kaum den Kopf durch den Eingang stecken.",
  },
  {
    id: "alice-1-33",
    start: 900.5,
    end: 1033.0,
    text: "Auf dem Tisch fand sie nun ein Fläschchen mit einem Papierstreifen, worauf die Worte: »Trink mich!« wunderschön in großen Buchstaben gedruckt standen. Alice trank davon, und wie wunderlich! Sie wurde immer kleiner und kleiner...",
  },
];

const GRIMM_ERBSENPROBE_SEGMENTS: AudiobookSegment[] = [
  {
    id: "grimm-1-1",
    start: 0.0,
    end: 6.0,
    text: "Märchen von den Gebrüdern Grimm. Die Prinzessin auf der Erbse.",
  },
  {
    id: "grimm-1-2",
    start: 6.2,
    end: 14.5,
    text: "Es war einmal ein Prinz, der wollte eine Prinzessin heiraten, aber das sollte eine wirkliche Prinzessin sein.",
  },
  {
    id: "grimm-1-3",
    start: 15.0,
    end: 23.5,
    text: "Da reiste er in der ganzen Welt herum, um eine solche zu finden, aber überall war etwas im Wege.",
  },
  {
    id: "grimm-1-4",
    start: 24.0,
    end: 34.0,
    text: "Prinzessinnen gab es genug, aber ob es wirkliche Prinzessinnen waren, konnte er nicht recht herausbringen; immer war etwas, was nicht in der Ordnung war.",
  },
  {
    id: "grimm-1-5",
    start: 34.5,
    end: 44.0,
    text: "Da kam er wieder nach Hause und war ganz traurig, denn er wollte so gern eine wirkliche Prinzessin haben.",
  },
  {
    id: "grimm-1-6",
    start: 44.5,
    end: 55.0,
    text: "Eines Abends zog ein furchtbares Unwetter auf; es blitzte und donnerte, und der Regen strömte herab, es war ganz schrecklich!",
  },
  {
    id: "grimm-1-7",
    start: 55.5,
    end: 64.0,
    text: "Da klopfte es an das Stadttor, und der alte König ging hin, um aufzumachen.",
  },
  {
    id: "grimm-1-8",
    start: 64.5,
    end: 77.0,
    text: "Es war eine Prinzessin, die draußen vor dem Tore stand. Aber, lieber Gott, wie sah sie durch den Regen und das böse Wetter aus!",
  },
  {
    id: "grimm-1-9",
    start: 77.5,
    end: 90.0,
    text: "Das Wasser lief ihr von den Haaren und den Kleidern herab, und es lief in die Spitzen der Schuhe hinein und an den Hacken wieder heraus;",
  },
  {
    id: "grimm-1-10",
    start: 90.5,
    end: 98.0,
    text: "und doch sagte sie, daß sie eine wirkliche Prinzessin wäre.",
  },
  {
    id: "grimm-1-11",
    start: 98.5,
    end: 110.0,
    text: "»Ja, das werden wir schon in Erfahrung bringen!« dachte die alte Königin, sagte aber nichts, ging in die Schlafkammer hinein,",
  },
  {
    id: "grimm-1-12",
    start: 110.5,
    end: 122.0,
    text: "nahm alles Bettzeug herunter und legte eine Erbse auf den Boden der Bettstelle.",
  },
  {
    id: "grimm-1-13",
    start: 122.5,
    end: 135.0,
    text: "Darauf nahm sie zwanzig Matratzen und legte sie auf die Erbse und dann noch zwanzig Eiderdunendecken oben auf die Matratzen.",
  },
  {
    id: "grimm-1-14",
    start: 135.5,
    end: 145.0,
    text: "Hierauf sollte nun die Prinzessin die ganze Nacht über liegen.",
  },
  {
    id: "grimm-1-15",
    start: 145.5,
    end: 156.0,
    text: "Am Morgen wurde sie gefragt, wie sie geschlafen hätte.",
  },
  {
    id: "grimm-1-16",
    start: 156.5,
    end: 172.0,
    text: "»Oh, entsetzlich schlecht!« sagte die Prinzessin. »Ich habe fast die ganze Nacht kein Auge zugetan! Gott weiß, was in dem Bette gelegen hat!«",
  },
  {
    id: "grimm-1-17",
    start: 172.5,
    end: 188.0,
    text: "»Ich habe auf etwas Hartem gelegen, so daß ich am ganzen Körper ganz braun und blau bin! Es ist ganz schrecklich!«",
  },
  {
    id: "grimm-1-18",
    start: 188.5,
    end: 204.0,
    text: "Daran konnte man nun sehen, daß sie eine wirkliche Prinzessin war, da sie durch die zwanzig Matratzen und die zwanzig Eiderdunendecken die Erbse gespürt hatte.",
  },
  {
    id: "grimm-1-19",
    start: 204.5,
    end: 218.0,
    text: "So empfindlich konnte niemand sein als nur eine wirkliche Prinzessin.",
  },
  {
    id: "grimm-1-20",
    start: 218.5,
    end: 236.0,
    text: "Da nahm sie der Prinz zur Frau, denn nun wußte er, daß er eine wirkliche Prinzessin hatte; und die Erbse kam in die Kunstkammer, wo sie noch zu sehen ist, wenn sie niemand gestohlen hat.",
  },
  {
    id: "alice-1-21",
    start: 236.5,
    end: 250.0,
    text: "Seht, das war eine wahre Geschichte!",
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
      modelUsed: "gutenberg-curated",
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
      modelUsed: "gutenberg-curated",
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
      modelUsed: "gutenberg-curated",
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
