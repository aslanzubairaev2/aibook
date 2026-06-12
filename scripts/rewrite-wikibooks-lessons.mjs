// One-off rewrite of the scraped Wikibooks German lessons 2-5.
//
// The originals are raw scrape output: English grammar explanations, dialogues
// collapsed into single lines, vocabulary as one giant paragraph, lost tables
// (numbers, pronouns, articles) and navigation cruft ("<< Lesson 1 | ...").
// This script replaces them with structured lesson pages following the
// formatting conventions of the "Lesson 1.0x" wikibooks lessons:
//   - section headings starting with Grammatik/Gespräch/Wortschatz/Übung/Text
//     (picked up by isLessonHeading in the reader and styled as headings)
//   - one dialogue line per paragraph
//   - vocabulary grouped into "label: de — ru / de — ru" lines
//   - explanations in Russian, German examples with Russian translations
//
// A DB-side backup of the original rows exists in
// wikibooks_lessons_backup_20260612 (created 2026-06-12).
//
// Usage:
//   node scripts/rewrite-wikibooks-lessons.mjs           # dry run
//   node scripts/rewrite-wikibooks-lessons.mjs --apply   # write changes
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv(resolve(root, ".env.local"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");

const LESSONS = [
  {
    id: "7b112672-b9e4-49db-a90b-06c91b0c437e",
    title: "Lektion 2: Fremde und Freunde (Незнакомцы и друзья)",
    paragraphs: [
      "Lektion 2: Fremde und Freunde (Незнакомцы и друзья)",
      "В этом уроке: глагол в настоящем времени, личные местоимения, вежливая форма Sie и два диалога в офисе.",

      "Grammatik 2-1: Глагол в настоящем времени",
      "Глагол — часть речи, которая описывает действие. В немецком языке форма глагола всегда согласуется с подлежащим — это правило работает без исключений. Сравните формы глагола studieren (учиться, изучать):",
      "Ich studiere Deutsch. — Я учу немецкий.",
      "Du studierst Mathematik. — Ты изучаешь математику.",
      "Er studiert in Berlin. — Он учится в Берлине.",
      "Was studierst du? — Что ты изучаешь?",
      "Обратите внимание: в немецком нет длительной формы. Все варианты «я учу», «я изучаю», «я сейчас учу» передаются одной формой — ich studiere.",
      "Глагол nennen переводится и как «называть», и как «звать»:",
      "Sie nennen die Firma „Trans-Global“. — Они называют фирму «Транс-Глобал».",
      "Nennen sie die Firma „Trans-Global“? — Они называют фирму «Транс-Глобал»? (в вопросе глагол и подлежащее меняются местами)",

      "Grammatik 2-2: Личные местоимения",
      "Местоимения из урока 1 чаще всего выступают подлежащим — это именительный падеж (Nominativ). Позже мы выучим ещё три падежа: Akkusativ (прямое дополнение), Dativ (косвенное дополнение) и Genitiv (принадлежность).",
      "Единственное число: ich — я / du — ты / er — он / sie — она / es — оно",
      "Множественное число: wir — мы / ihr — вы / sie — они",
      "Ich habe eine Frage. — У меня есть вопрос.",
      "Du hast zu viel Arbeit. — У тебя слишком много работы.",
      "Wir arbeiten heute. — Мы сегодня работаем.",
      "Ihr studiert Deutsch. — Вы учите немецкий.",
      "Sie haben eine Firma. — У них есть фирма.",

      "Gespräch 2-1: Im Büro (В офисе)",
      "Herr Schmidt trifft Frau Baumann. Sie sind Geschäftsleute und sie arbeiten an dem Hauptsitz. — Господин Шмидт встречает госпожу Бауманн. Они деловые люди и работают в главном офисе.",
      "Herr Schmidt: Guten Tag, Frau Baumann!",
      "Frau Baumann: Guten Tag, Herr Schmidt!",
      "Herr Schmidt: Wie geht es Ihnen?",
      "Frau Baumann: Sehr gut, danke. Und Ihnen?",
      "Herr Schmidt: Auch gut.",
      "Frau Baumann: Schön. Haben Sie Herrn Standish schon getroffen?",
      "Herr Schmidt: Aus England? Nein. Ist er zu Besuch?",
      "Frau Baumann: Ja. Das ist richtig! Auf Wiedersehen, Herr Schmidt!",
      "Herr Schmidt: Auf Wiedersehen, Frau Baumann!",
      "Тема разговора бытовая, но коллеги говорят в вежливой форме (Sie) — так принято в официальной обстановке. Подробнее — в Grammatik 2-3.",

      "Wortschatz 2-1 (Словарь):",
      "Существительные: die Anleitungen — инструкции / das Deutsch — немецкий язык / der Fremde — незнакомец, иностранец / die Firma — фирма, компания / die Frage — вопрос / die Geschäftsleute — деловые люди (die Leute — люди) / der Hauptsitz — главный офис (das Haupt — глава) / der Tag — день",
      "Выражения: aus England — из Англии / Das ist richtig! — Это верно! / zu Besuch — в гостях, с визитом / Guten Tag! — Добрый день!",
      "Глаголы: arbeiten — работать / nennen — называть, звать / treffen (getroffen) — встречать (встретил)",
      "Прочее: alle — все / an — у, при / Ihnen — Вам (вежливая форма) / heute — сегодня / ihr — вы (мн. число) / ja — да / nein — нет / richtig — правильный, верный / sie — они; она / Sie — Вы (вежливая форма) / wir — мы",

      "Grammatik 2-3: Вежливая форма Sie",
      "В диалогах урока 1 друзья говорили друг другу du («ты») — это доверительная форма. С незнакомыми людьми и в формальной обстановке используется вежливая форма Sie («Вы»).",
      "Вежливые Sie и Ihnen всегда пишутся с большой буквы. Это помогает отличать на письме Sie («Вы») от sie («она» или «они»), а Ihnen («Вам») от ihnen («им»).",
      "В устной речи различить их помогает форма глагола. Сравните примеры с глаголом haben (иметь):",
      "Haben Sie Fragen? — У Вас есть вопросы? (вежливое «Вы»)",
      "Hat sie Fragen? — У неё есть вопросы?",
      "Haben sie Fragen? — У них есть вопросы?",
      "В начале предложения любое слово пишется с большой буквы, поэтому без формы глагола не понять, о ком речь — здесь решает контекст.",

      "Gespräch 2-2: Am Hauptsitz (В главном офисе)",
      "Herr Schmidt und Herr Standish begegnen sich am Hauptsitz. — Господин Шмидт и господин Стэндиш встречаются в главном офисе.",
      "Herr Schmidt: Guten Morgen, Herr Standish! Wie geht es Ihnen?",
      "Herr Standish: Danke sehr, es geht mir gut. Und Ihnen?",
      "Herr Schmidt: Nicht so gut. Ich bin müde.",
      "Herr Standish: Wie bitte? Müde? Warum?",
      "Herr Schmidt: Ich habe so viel Arbeit.",
      "Herr Standish: Das kann ich verstehen. Zu viel ist zu viel.",
      "Herr Schmidt: Das ist richtig. Auf Wiedersehen, Herr Standish!",
      "Herr Standish: Auf Wiedersehen, bis morgen.",

      "Wortschatz 2-2 (Словарь):",
      "Существительные: die Arbeit — работа / die Bundesrepublik Deutschland — Федеративная Республика Германия / Großbritannien — Великобритания / der Morgen — утро / die Übersetzung — перевод",
      "Выражения: bis morgen — до завтра / Guten Morgen! — Доброе утро! / nicht so gut — не очень хорошо / so viel — так много / Wie bitte? — Простите, как? / zu viel — слишком много",
      "Прочее: müde — усталый / nicht — не / kein — никакой, ни один (отрицание) / warum? — почему? / verstehen — понимать / sich begegnen — встречаться (друг с другом)",

      "Grammatik 2-4: Род местоимений 3-го лица",
      "В немецком местоимение 3-го лица повторяет род существительного, которое оно заменяет — даже у неодушевлённых предметов:",
      "der Tag (день) → er: Der Tag ist schön. Er ist schön. — День прекрасен. Он прекрасен.",
      "die Firma (фирма) → sie: Die Firma ist groß. Sie ist groß. — Фирма большая. Она большая.",
      "das Buch (книга) → es: Das Buch ist gut. Es ist gut. — Книга хорошая. Она хорошая.",

      "Übung 2-1 (Упражнение):",
      "Переведите предложения на немецкий. Обращайте внимание, какая форма нужна — доверительная (du) или вежливая (Sie):",
      "1. Добрый день, госпожа Нойманн. Как у Вас дела?",
      "2. У меня всё хорошо, спасибо. А у Вас?",
      "3. Катрин изучает математику.",
      "4. Они встречаются в главном офисе.",
      "5. Я понимаю инструкции.",
      "6. Она приехала в гости из Англии?",
      "7. Как Вы сказали? У Вас слишком много работы?",
      "8. До свидания, господин Шмидт. До завтрашнего утра?",
    ],
  },
  {
    id: "06fd3c25-dae5-4472-b2af-fe070926d1bf",
    title: "Lektion 3: Die Zahlen (Числа)",
    paragraphs: [
      "Lektion 3: Die Zahlen (Числа)",
      "В этом уроке: числа от 1 до 12, который час, род существительных и артикли der, die, das, ein, eine.",

      "Grammatik 3-1: Числа от 1 до 12",
      "Счёт — навык, который стоит освоить как можно раньше. Как и в русском, в немецком есть количественные числительные (один, два, три) и порядковые (первый, второй, третий). Первые двенадцать чисел — особые слова, их нужно запомнить. Числа больше двенадцати образуются по правилам — о них в следующих уроках.",
      "1 — eins (один), der erste (первый)",
      "2 — zwei (два), der zweite (второй)",
      "3 — drei (три), der dritte (третий)",
      "4 — vier (четыре), der vierte (четвёртый)",
      "5 — fünf (пять), der fünfte (пятый)",
      "6 — sechs (шесть), der sechste (шестой)",
      "7 — sieben (семь), der siebte (седьмой)",
      "8 — acht (восемь), der achte (восьмой)",
      "9 — neun (девять), der neunte (девятый)",
      "10 — zehn (десять), der zehnte (десятый)",
      "11 — elf (одиннадцать), der elfte (одиннадцатый)",
      "12 — zwölf (двенадцать), der zwölfte (двенадцатый)",
      "Порядковые числительные образуются прибавлением -te: zehn → zehnte. Запомните три исключения: erste (первый), dritte (третий) и siebte (седьмой).",
      "Примерное произношение: eins [айнс] / zwei [цвай] / drei [драй] / vier [фир] / fünf [фюнф] / sechs [зэкс] / sieben [зибн] / acht [ахт] / neun [нойн] / zehn [цейн] / elf [эльф] / zwölf [цвёльф]",

      "Gespräch 3-1: Der Ball (Мяч)",
      "Zwei Jungen, Heinrich und Karl, sind Freunde. Sie begegnen sich eines Nachmittags. — Два мальчика, Генрих и Карл, — друзья. Однажды после обеда они встречаются.",
      "Heinrich: Karl. Wie geht's?",
      "Karl: Hallo!",
      "Heinrich: Willst du spielen? Ich habe einen Ball.",
      "Karl: Wie spät ist es?",
      "Heinrich: Es ist ein Uhr.",
      "Karl: Dann kann ich bis zwei Uhr spielen.",
      "Heinrich: Das ist gut. Wir spielen eine Stunde lang!",

      "Grammatik 3-2: Wie spät ist es? (Который час?)",
      "Зная числа от 1 до 12, можно спрашивать и называть время. Вопрос звучит так: Wie spät ist es? (дословно «насколько поздно?»). Ответ строится по схеме Es ist ___ Uhr, где на место пропуска ставится число (для часа дня говорят ein, а не eins).",
      "Wie spät ist es? — Который час?",
      "Es ist ein Uhr. — Сейчас час.",
      "Es ist drei Uhr. — Сейчас три часа.",
      "Es ist Viertel nach drei. — Четверть четвёртого (дословно: «четверть после трёх»).",
      "Es ist halb vier. — Половина четвёртого. Внимание: halb vier — это 3:30, а не 4:30!",
      "Es ist Viertel vor vier. — Без четверти четыре.",
      "Немцы, как и большинство европейцев, часто используют 24-часовой формат времени. Когда вы научитесь считать дальше двенадцати, сможете называть время с точностью до минуты.",

      "Wortschatz 3-1 (Словарь):",
      "Существительные: der Ball — мяч / der Junge, die Jungen — мальчик, мальчики / das Lernen — учёба / der Nachmittag — вторая половина дня / die Stunde — час (промежуток времени) / die Uhr — часы (прибор); также «час» при указании времени / der Uhrturm — часовая башня / die Uhrzeit — время суток / das Viertel — четверть / die Zahl, die Zahlen — число, числа",
      "Выражения: bis zwei Uhr — до двух часов / das ist gut — хорошо, отлично / eines Nachmittags — однажды после обеда / ich kann spielen — я могу играть / es ist — сейчас (о времени) / willst du...? — хочешь...? (доверительная форма)",
      "Глаголы: fragen — спрашивать / spielen — играть / zählen — считать",
      "Прочее: dann — тогда, затем / halb — половина / nach — после / spät — поздно / vor — до, перед / zu — к; слишком",

      "Grammatik 3-3: Род существительных и der, die, das",
      "Существительное в немецком всегда пишется с большой буквы — и имена собственные, и обычные слова. У каждого существительного есть род: мужской, женский или средний. Род показывает определённый артикль:",
      "der — мужской род: der Mann — мужчина / der Junge — мальчик / der Ball — мяч",
      "die — женский род: die Frau — женщина / die Uhr — часы / die Firma — фирма",
      "das — средний род: das Buch — книга / das Mädchen — девочка / das Viertel — четверть",
      "Род не всегда совпадает с «логикой»: der Junge (мальчик) — мужской род, но das Mädchen (девочка) — средний! А «часы» (die Uhr) — женский. Поэтому каждое новое существительное запоминайте сразу с артиклем: не Buch, а das Buch.",
      "От рода зависят окончания артиклей и прилагательных, поэтому неверный род может изменить смысл предложения.",

      "Grammatik 3-4: Неопределённый артикль ein, eine",
      "Кроме определённого артикля (der, die, das — конкретный предмет) есть неопределённый (ein, eine — какой-то, один из многих). Сравните: das Buch — та самая книга, ein Buch — какая-то книга.",
      "ein — мужской род: ein Mann — (какой-то) мужчина",
      "eine — женский род: eine Frau — (какая-то) женщина",
      "ein — средний род: ein Buch — (какая-то) книга",
      "Ich habe einen Ball. — У меня есть мяч.",
      "Почему einen, а не ein? Это винительный падеж (Akkusativ) — он отмечает прямое дополнение. Все падежи мы разберём в следующем уроке.",

      "Wortschatz 3-2 (Словарь):",
      "das Buch — книга / die Frau — женщина / der Knödel — клёцка / das Mädchen — девочка, девушка / der Mann — мужчина / lesen — читать",

      "Übung 3-1 (Упражнение):",
      "Переведите предложения на немецкий:",
      "1. Я читаю до десяти часов.",
      "2. Сейчас без четверти десять.",
      "3. Кати — студентка университета.",
      "4. Она встречает Марка на улице.",
      "5. Девочка — подруга.",
      "6. У господина Шмидта есть вопрос.",
    ],
  },
  {
    id: "11648e4a-8938-462f-9d6f-79ce63c34beb",
    title: "Lektion 4: Zürich und die Fälle (Цюрих и падежи)",
    paragraphs: [
      "Lektion 4: Zürich und die Fälle (Цюрих и падежи)",
      "В этом уроке: текст для чтения о Цюрихе, прилагательные, падежи Akkusativ и Dativ, артикли по падежам и вопросительные слова.",

      "Text 4-1: Zürich (Текст для чтения)",
      "Zürich ist die größte Stadt der Schweiz. Sie liegt am Ausfluss des Zürichsees und ist die Hauptstadt des gleichnamigen Kantons, des Kantons Zürich. Zürich ist ausgesprochen schön gelegen, am nördlichen Ende des Zürichsees — bei klarem Wetter hat man eine gute Sicht auf die Glarner Alpen.",
      "Zürich ist das Zentrum der schweizer Bankenwirtschaft. Neben den beiden Großbanken („Credit Suisse“ und „UBS“) haben auch etliche kleinere Bankinstitute ihren Sitz in der Stadt.",
      "В тексте много существительных и прилагательных, но со словарём 4-1 вы без труда его поймёте. Здесь активно используется родительный падеж (Genitiv), который мы ещё не проходили. Подсказка: переводите des как «(чего)»: des Zürichsees — «Цюрихского озера».",

      "Wortschatz 4-1 (Словарь):",
      "Существительные: die Alpen — Альпы / der Ausfluss — исток, сток (озера) / die Bankinstitute — банковские учреждения / die Bankenwirtschaft — банковское дело / das Ende — конец / die Großbanken — крупные банки / die Hauptstadt — столица / das Haus — дом / der Kanton — кантон (швейцарская земля) / das Lesestück — текст для чтения / die Schweiz — Швейцария / die Sicht — вид / der Sitz — офис, резиденция / das Wetter — погода / das Zentrum — центр / der Zürichsee — Цюрихское озеро",
      "Выражения: d.h. (das heißt) — т.е., то есть / man hat... — имеется... / nach Hause — домой (сравните: zu Hause — дома) / am (an dem) — у, на",
      "Глаголы: anrufen — звонить (по телефону) / geben (gab, gegeben) — давать / kommen (kam, gekommen) — приходить / liegen (lag, gelegen) — лежать, располагаться",
      "Прилагательные и прочее: ausgesprochen — исключительно, подчёркнуто / bei — при / beiden — оба / etliche — несколько, целый ряд / gleichnamig — одноимённый / größte — самый большой / klar — ясный / klein — маленький / neben — рядом с; помимо / nördlich — северный / schweizer — швейцарский",

      "Grammatik 4-1: Прилагательные",
      "Прилагательное описывает предмет и в немецком, как и в русском, обычно стоит перед существительным. Вы уже встречали прилагательные в тексте:",
      "bei klarem Wetter — при ясной погоде",
      "eine gute Sicht — хороший вид",
      "die größte Stadt — самый большой город",
      "Обратите внимание: окончания прилагательных меняются (klarem, gute, größte) в зависимости от рода и падежа существительного. Правила окончаний мы разберём после знакомства с падежами.",
      "Кстати, порядковые числительные из урока 3 (erste, zweite...) — это тоже прилагательные, и они подчиняются тем же правилам.",

      "Gespräch 4-1: Das neue Mädchen (Новенькая)",
      "Markus und Helena sind Freunde. — Маркус и Хелена — друзья.",
      "Markus: Lena, wer ist das neue Mädchen? Die Brünette dort drüben.",
      "Helena: Ich glaube, sie heißt „Karoline“.",
      "Markus: Sie ist sehr schön.",
      "Helena: Sie ist hübsch, wenn man kleine Mädchen mit langen dunklen Haaren mag.",
      "Markus: Ja. Ihre Haare gefallen mir sehr.",
      "Helena: Markus, du bist ein Ferkel!",

      "Wortschatz 4-2 (Словарь):",
      "Существительные: die Brünette — брюнетка / die Haare — волосы / das Mädchen — девочка, девушка / das Ferkel — поросёнок",
      "Глаголы: gefallen — нравиться / glauben — полагать, верить / heißen — зваться / mag — любит, нравится (от mögen)",
      "Прочее: dort — там / (dort) drüben — вон там / dunkel — тёмный / ihr — её / hübsch — хорошенькая / klein — маленький, невысокий / lang — длинный / neu — новый / wenn — если / wer? — кто?",

      "Grammatik 4-2: Падежи — Akkusativ и Dativ",
      "В немецком четыре падежа. Nominativ (именительный) — подлежащее. Akkusativ (винительный) — прямое дополнение, на которое направлено действие. Dativ (дательный) — косвенное дополнение, адресат действия. Genitiv (родительный) выражает принадлежность — о нём позже.",
      "Личные местоимения по падежам:",
      "Nominativ: ich — я / du — ты / er, sie, es — он, она, оно / wir — мы / ihr — вы / sie — они / Sie — Вы",
      "Akkusativ: mich — меня / dich — тебя / ihn, sie, es — его, её, его / uns — нас / euch — вас / sie — их / Sie — Вас",
      "Dativ: mir — мне / dir — тебе / ihm, ihr, ihm — ему, ей, ему / uns — нам / euch — вам / ihnen — им / Ihnen — Вам",
      "Sie gibt mir das Buch. — Она даёт мне книгу. (mir — дательный падеж, никакого предлога не нужно)",
      "Помните неполное предложение Und Ihnen? («А у Вас?») из Gespräch 2-1? Местоимение стоит в дательном падеже, потому что подразумевается полное Und wie geht es Ihnen?",

      "Grammatik 4-3: Артикли по падежам",
      "Существительные в немецком не меняют форму по падежам — падеж показывает артикль перед словом. Определённый артикль:",
      "Nominativ: der (м) / die (ж) / das (с) / die (мн. число)",
      "Akkusativ: den (м) / die (ж) / das (с) / die (мн. число)",
      "Dativ: dem (м) / der (ж) / dem (с) / den (мн. число)",
      "Запомнить проще, чем кажется: у женского, среднего рода и множественного числа Nominativ и Akkusativ совпадают. Меняется только мужской род: der → den. В Dativ мужской и средний род одинаковы: dem.",
      "Неопределённый артикль:",
      "Nominativ: ein (м) / eine (ж) / ein (с)",
      "Akkusativ: einen (м) / eine (ж) / ein (с)",
      "Dativ: einem (м) / einer (ж) / einem (с)",
      "Окончания у ein повторяют определённый артикль: dem → einem, der → einer. Во множественном числе неопределённого артикля нет — как и в русском.",
      "Der Mann liest das Buch. — Мужчина читает книгу.",
      "Ich sehe den Mann. — Я вижу мужчину. (Akkusativ)",
      "Sie gibt dem Mann ein Buch. — Она даёт мужчине книгу. (Dativ)",

      "Grammatik 4-4: Вопросительные слова",
      "Вопросительное слово занимает место неизвестного и подсказывает, какой ответ ожидается:",
      "wann? — когда? Wann kommst du? — Когда ты придёшь?",
      "warum? — почему? Warum sind Sie müde? — Почему Вы устали?",
      "was? — что? Was ist das? — Что это?",
      "wer? — кто? Wer ist das Mädchen? — Кто эта девочка?",
      "wie? — как? Wie geht es dir? — Как у тебя дела?",
      "wieviel? — сколько? Wieviel Uhr ist es? — Сколько времени?",
      "wo? — где? Wo ist das Buch? — Где книга?",
      "wohin? — куда? Wohin gehst du? — Куда ты идёшь?",

      "Übung 4-1 (Упражнение):",
      "Переведите предложения на немецкий:",
      "1. У них хороший вид на Альпы.",
      "2. Цюрихское озеро очень красивое.",
    ],
  },
  {
    id: "005f987f-d77d-4948-ab34-62c6f423b0a3",
    title: "Lektion 5: Wiederholung (Повторение)",
    paragraphs: [
      "Lektion 5: Wiederholung (Повторение)",
      "Урок 5 — повторение материала уроков 1–4. Вернитесь к уроку 1 и перечитайте каждый из четырёх уроков. Ниже — краткая сводка главного.",

      "Grammatik 5-1: Структура предложения",
      "Предложение состоит из частей, каждая из которых выполняет свою роль. Вы уже знакомы с основными частями речи: местоимения и существительные, глаголы, прилагательные. Разберём два примера:",
      "Ich brauche Wurst und Käse. — Мне нужны колбаса и сыр.",
      "ich — местоимение-подлежащее / brauche — глагол / Wurst und Käse — существительные, прямые дополнения",
      "Haben sie zu viel Arbeit? — У них слишком много работы?",
      "haben — глагол / sie — местоимение-подлежащее / zu viel — «слишком много» / Arbeit — существительное, прямое дополнение",
      "Порядок слов в простом утвердительном предложении: сначала подлежащее, потом глагол. В вопросе глагол и подлежащее меняются местами: Sie haben... → Haben Sie...?",

      "Grammatik 5-2: Существительные",
      "Существительное называет человека, место или предмет и в немецком всегда пишется с большой буквы. У каждого существительного есть род — мужской, женский или средний. Род запоминается вместе с определённым артиклем: der, die или das.",
      "В словарях этого курса существительные даются с артиклем, а иногда и с формой множественного числа:",

      "Wortschatz 5-1 (Словарь):",
      "der Anhang, die Anhänge — приложение, приложения / die Brücke — мост / der Freund, die Freunde — друг, друзья / das Gespräch, die Gespräche — разговор, разговоры / die Grammatik — грамматика / die Lektion — урок / die Straße — улица",

      "Übung 5-1 (Повторение):",
      "Проверьте себя по материалам уроков 1–4:",
      "1. Назовите личные местоимения в Nominativ, Akkusativ и Dativ.",
      "2. Чем отличается вежливая форма Sie от sie («она», «они»)?",
      "3. Просклоняйте определённый артикль der, die, das по падежам.",
      "4. Посчитайте от eins до zwölf и назовите порядковые числительные.",
      "5. Ответьте по-немецки: Wie spät ist es?",
    ],
  },
];

async function main() {
  // Local safety copy of the current rows before touching anything.
  const ids = LESSONS.map((l) => l.id);
  const { data: current, error: fetchErr } = await supabase
    .from("shared_book_chapters")
    .select("shared_book_id, chapter_index, paragraphs, plain_text")
    .in("shared_book_id", ids);
  if (fetchErr) {
    console.error("Failed to fetch current rows:", fetchErr.message);
    process.exit(1);
  }

  for (const lesson of LESSONS) {
    const row = (current ?? []).find((r) => r.shared_book_id === lesson.id);
    console.log(
      `${lesson.id}  "${lesson.title}"\n` +
      `  current: ${row ? row.paragraphs.length : "?"} paragraphs -> new: ${lesson.paragraphs.length} paragraphs`
    );
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write changes.");
    return;
  }

  mkdirSync(resolve(root, "scratch"), { recursive: true });
  const backupPath = resolve(root, "scratch", `wikibooks-lessons-backup-${Date.now()}.json`);
  writeFileSync(backupPath, JSON.stringify(current, null, 2), "utf8");
  console.log(`\nBackup written: ${backupPath}`);

  for (const lesson of LESSONS) {
    const plainText = lesson.paragraphs.join("\n");
    const { error: chErr } = await supabase
      .from("shared_book_chapters")
      .update({
        paragraphs: lesson.paragraphs,
        plain_text: plainText,
        char_count: plainText.length,
      })
      .eq("shared_book_id", lesson.id);
    if (chErr) {
      console.error(`FAILED chapters update for ${lesson.id}:`, chErr.message);
      process.exit(1);
    }

    const { error: bookErr } = await supabase
      .from("shared_books")
      .update({ title: lesson.title })
      .eq("id", lesson.id);
    if (bookErr) {
      console.error(`FAILED title update for ${lesson.id}:`, bookErr.message);
      process.exit(1);
    }

    console.log(`Updated: ${lesson.title}`);
  }

  console.log("\nDone. DB backup also exists in table wikibooks_lessons_backup_20260612.");
}

main();
