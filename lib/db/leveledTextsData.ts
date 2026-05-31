export type LeveledTextSeed = {
  title: string;
  author: string;
  language: string;
  cefrLevel: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  paragraphs: string[];
  sourceType: "universal_cefr" | "wikibooks";
  lessonNumber?: string;
  description?: string;
};

export const LEVELED_TEXTS_SEED: LeveledTextSeed[] = [
  // --- WIKIBOOKS GERMAN CURRICULUM (LEVEL I & II) ---
  {
    title: "Lesson 1.00: Introduction (Введение)",
    author: "Wikibooks",
    language: "de",
    cefrLevel: "A1",
    sourceType: "wikibooks",
    lessonNumber: "1.00",
    description: "Введение в курс немецкого языка. Сравнение немецкого и английского языков, алфавит и правила чтения.",
    paragraphs: [
      "Willkommen zum Deutschkurs! Добро пожаловать на курс немецкого языка! Немецкий язык (Deutsch) принадлежит к германской ветви индоевропейской языковой семьи. Он имеет много общего с английским языком, так как они являются родственными языками.",
      "Многие слова в немецком и английском языках пишутся почти одинаково и имеют общие корни, например: Haus (house), Hand (hand), Buch (book), Katze (cat), Vater (father), Mutter (mother), Name (name), Garten (garden), Wind (wind), Sturm (storm), Fisch (fish).",
      "Однако есть и ключевые различия. В немецком языке все существительные пишутся с заглавной буквы, независимо от их положения в предложении или принадлежности к именам собственным. Глаголы часто занимают строго определённое второе место в простых предложениях или перемещаются в самый конец в придаточных."
    ]
  },
  {
    title: "Lesson 1.01: Wie heißt du? (Как тебя зовут?)",
    author: "Wikibooks",
    language: "de",
    cefrLevel: "A1",
    sourceType: "wikibooks",
    lessonNumber: "1.01",
    description: "Первые фразы приветствия и знакомства. Диалог Франца и Греты.",
    paragraphs: [
      "Dialogue (Диалог):",
      "Franz: Hallo, ich bin Franz. Wie heißt du?",
      "Greta: Hallo, Franz. Ich heiße Greta. Wie geht's?",
      "Franz: Es geht mir gut. Kennst du den Lehrer?",
      "Greta: Ja, er heißt Herr Weiß.",
      "Franz: Oh, danke, Greta. Bis dann!",
      "Greta: Wiedersehen!",
      "Vocabulary (Словарь уроков):",
      "Hallo! – Привет! / Ich bin... – Я... / Wie heißt du? – Как тебя зовут? / Ich heiße... – Меня зовут... / Wie geht's? – Как дела? / Es geht mir gut. – У меня все хорошо. / Kennst du...? – Ты знаешь...? / Herr – Господин / Wiedersehen! – До свидания!"
    ]
  },
  {
    title: "Lesson 1.02: Freizeit (Свободное время)",
    author: "Wikibooks",
    language: "de",
    cefrLevel: "A1",
    sourceType: "wikibooks",
    lessonNumber: "1.02",
    description: "Хобби, спорт и выражение личных предпочтений. Глаголы spielen и machen.",
    paragraphs: [
      "Dialogue (Диалог):",
      "Franz: Hallo, Greta! Wie spät ist es?",
      "Greta: Es ist Viertel vor drei.",
      "Franz: Wirklich? Ich spiele um drei Fußball. Machst du Sport, Greta?",
      "Greta: Nein, ich bin faul. Ich gehe jetzt nach Hause.",
      "Franz: Fußball macht aber Spaß!",
      "Greta: Bis dann. / Franz: Wiedersehen!",
      "Grammar & Words (Грамматика):",
      "Fußball spielen – играть в футбол. Sport machen – заниматься спортом. В немецком языке для выражения хобби часто используется конструкция с наречием 'gern' (охотно): 'Ich spiele gerne Fußball' (Я с удовольствием играю в футбол).",
      "Спряжение глагола 'spielen' (играть) в настоящем времени: ich spiele, du spielst, er/sie/es spielt, wir spielen, ihr spielt, sie/Sie spielen.",
      "Спряжение глагола 'machen' (делать) в настоящем времени: ich mache, du machst, er/sie/es macht, wir machen, ihr macht, sie/Sie machen."
    ]
  },
  {
    title: "Lesson 1.03: Essen (Еда)",
    author: "Wikibooks",
    language: "de",
    cefrLevel: "A1",
    sourceType: "wikibooks",
    lessonNumber: "1.03",
    description: "Еда, напитки, заказ в ресторане и винительный падеж (Akkusativ).",
    paragraphs: [
      "Dialogue (Диалог):",
      "Franz: Hallo, Greta! Wie geht's?",
      "Greta: Sehr gut. Ich habe Hunger.",
      "Franz: Ich auch. Möchtest du etwas essen?",
      "Greta: Ja! In der Gaststätte (В ресторане).",
      "Greta: Ich möchte Salat, Brot und Wasser.",
      "Franz: Hast du jetzt keinen Hunger?",
      "Greta: Doch, ich habe großen Hunger. Was bekommst du?",
      "Franz: Ich bekomme ein Stück Apfelstrudel und einen Eisbecher.",
      "Greta: Warum das? Du sollst eine Bratwurst nehmen.",
      "Franz: Nein, ich bin zufrieden. Ich habe keinen großen Hunger.",
      "Greta: Ach so, dann ist das genug. Nach zwanzig Minuten...",
      "Greta: Diese Gaststätte ist schrecklich! Ich möchte etwas zu essen! / Franz: Wir gehen!",
      "Grammar (Грамматика):",
      "Ich habe Hunger – Я голоден. Ich habe Durst – Я хочу пить. Модальный глагол 'möchten' (хотелось бы): ich möchte, du möchtest, er/sie/es möchte, wir möchten, ihr möchtet, sie/Sie möchten.",
      "Винительный падеж (Akkusativ): мужской род меняет артикль 'der/ein' на 'den/einen' (einen Eisbecher, den Salat). Женский (die/eine) и средний род (das/ein) остаются без изменений."
    ]
  },
  {
    title: "Lesson 1.04: Kleidung (Одежда)",
    author: "Wikibooks",
    language: "de",
    cefrLevel: "A2",
    sourceType: "wikibooks",
    lessonNumber: "1.04",
    description: "Одежда, цвета и покупки на торговой улице Kurfürstendamm. Отделяемые приставки.",
    paragraphs: [
      "Dialogue (Диалог):",
      "Sarah: Morgen, Lisa.",
      "Lisa: Morgen. Wie geht's dir?",
      "Sarah: Gut, danke! Ich gehe zum Kurfürstendamm, möchtest du mitkommen?",
      "Lisa: Ja, gerne. Ich hole vorher noch Geld.",
      "Sarah: Ich sehe dich dann am Kurfürstendamm.",
      "am Kurfürstendamm (На Курфюрстендамм):",
      "Sarah: Hallo Lisa! / Lisa: Hallo! / Sarah: Wohin gehen wir zuerst?",
      "Lisa: Lass uns zu dieser Boutique gehen. / Sarah: O.K.",
      "in der Boutique (В бутике):",
      "Angestellter Thomas: Hallo meine Damen! / Sarah und Lisa: Guten Tag!",
      "Angestellter Thomas: Darf ich Ihnen helfen?",
      "Lisa: Ja, können Sie mir helfen, diesen Rock in meiner Größe zu finden?",
      "Angestellter Thomas: Natürlich. Hier ist der Rock in Ihrer Größe.",
      "Lisa: Danke. Wo ist die Umkleidekabine? / Angestellter Thomas: Dort drüben.",
      "Grammar & Vocabulary (Грамматика):",
      "Глаголы с отделяемыми приставками (Trennbar). Например, 'aussehen' (выглядеть) и 'anziehen' (надевать). Приставка уходит в конец простого предложения: 'Das Hemd sieht prima aus!' (Рубашка выглядит отлично!).",
      "Цвета (Farben): Rot (красный), Blau (синий), Grün (зеленый), Gelb (желтый), Schwarz (черный), Weiß (белый), Grau (серый)."
    ]
  },
  {
    title: "Lesson 1.05: Volk und Familie (Семья и люди)",
    author: "Wikibooks",
    language: "de",
    cefrLevel: "A2",
    sourceType: "wikibooks",
    lessonNumber: "1.05",
    description: "Разговоры о семье, описание характера людей и притяжательные местоимения.",
    paragraphs: [
      "Dialogue (Диалог):",
      "Vater, Mutter und die Geschwister bekommen Besuch von Oma und Opa.",
      "Vater Karl: Hallo Mama, Hallo Papa! Wie geht es euch?",
      "Opa Rudolf: Na mein Enkel, du bist ja richtig groß geworden!",
      "Oma Lisa: Mir geht's gut. Ich gehe zum Kurfürstendamm. Möchtet ihr mit mir kommen?",
      "Sohn Thomas: Ja, Opa, ich weiß. / Tochter Marie: Oma! Hast du uns etwas mitgebracht?",
      "Mutter Bettina: Nun sei nicht so aufgeregt Marie, lass Oma und Opa erst einmal hereinkommen.",
      "kurze Zeit später, die Geschenke wurden schon ausgepackt (чуть позже, подарки уже распакованы):",
      "Tochter Marie: Mutti! Thomas nimmt mir immer meine Puppe weg.",
      "Mutter Bettina: Thomas! Du sollst deiner Schwester nicht ihre Puppe wegnehmen.",
      "Sohn Thomas: Nein, das ist meine Puppe. / Mutter Bettina: Nein. Die Puppe gehört deiner Schwester.",
      "Sohn Thomas: Gut, hier hast du die Puppe... / Mutter Bettina: Und bedanke dich bei deinen Großeltern, Marie.",
      "Vocabulary (Слова):",
      "der Sohn (сын), die Tochter (дочь), der Vater (отец), die Mutter (мать), der Großvater (дедушка), die Großmutter (бабушка), die Geschwister (братья и сестры).",
      "Притяжательные местоимения (Possessiv): mein (мой), dein (твой), sein (его), ihr (её/их), unser (наш), euer (ваш), Ihr (Ваш - вежл.)."
    ]
  },
  {
    title: "Lesson 1.06: Schule (Школа)",
    author: "Wikibooks",
    language: "de",
    cefrLevel: "A2",
    sourceType: "wikibooks",
    lessonNumber: "1.06",
    description: "Учеба в школе, школьные предметы и расписание уроков.",
    paragraphs: [
      "Dialogue (Диалог):",
      "Silke: Jetzt haben wir Mathe.",
      "Torsten: Oh nein, ich habe überhaupt keine Lust dazu.",
      "Silke: Hast du die Aufgaben gemacht? / Torsten: Ja, im Bus.",
      "Silke: Super! Kann ich sie abschreiben?",
      "Lehrer (Betritt den Raum): Guten Morgen! / Klasse: Guten Morgen!",
      "Lehrer: Wer möchte die Aufgaben an der Tafel rechnen? Florian?",
      "Florian geht zur Tafel, schreibt an und liest vor:",
      "5 plus 8 ist gleich 13. 8 minus 5 ist gleich 3.",
      "Lehrer: Sehr gut, Florian!",
      "Die Glocke läutet. Es ist Fünfminutenpause (Звенит звонок. Пятиминутная перемена):",
      "Silke: Schnell, wir müssen zu Musik! / Torsten: Au ja, darauf freue ich mich schon.",
      "Silke: Was machen wir heute? / Torsten: Wir wollen ein Lied von Grönemeyer singen!",
      "School Subjects (Школьные предметы):",
      "Mathe/Mathematik (математика), Deutsch (немецкий язык), Englisch (английский язык), Geschichte (история), Biologie (биология), Physik (физика), Chemie (химия), Kunst (рисование), Musik (музыка)."
    ]
  },
  {
    title: "Lesson 1.07: Das Fest (Праздник)",
    author: "Wikibooks",
    language: "de",
    cefrLevel: "B1",
    sourceType: "wikibooks",
    lessonNumber: "1.07",
    description: "Традиции Рождества в Германии, дательный падеж (Dativ) и праздничные блюда.",
    paragraphs: [
      "Dialogue (Диалог):",
      "Roswitha: Heute ist der erste Advent. Lass uns zusammen schmücken!",
      "Anja: Au ja, Mama. Ich hole die Dekoration heraus.",
      "Roswitha: Den Adventskranz stellen wir wie jedes Jahr auf den Wohnzimmertisch und die Weihnachtspyramide kommt auf das Regal.",
      "Anja: Wo soll ich den Räuchermann hinstellen?",
      "Roswitha: Stelle ihn bitte mal auf den Fenstersims hin, Mäuschen.",
      "Anja: Wird gemacht!",
      "Grammar (Грамматика Dativ):",
      "Дательный падеж отвечает на вопрос 'Wem?' (Кому?). Артикли меняются следующим образом: der/das -> dem, die -> der, die (Plural) -> den (+ n на конце существительного).",
      "Примеры: 'Die Kokosmakronen gehören der Anja' (Кокосовое печенье принадлежит Ане). 'Lisa schenkt dem Björn ein Spekulatius' (Лиза дарит Бьёрну рождественское печенье)."
    ]
  },

  // --- UNIVERSALCEFR ENGLISH & GERMAN PASSAGES ---
  {
    title: "Meeting New Friends",
    author: "UniversalCEFR",
    language: "en",
    cefrLevel: "A1",
    sourceType: "universal_cefr",
    description: "Простой текст о Саре, её семье и хобби на английском языке.",
    paragraphs: [
      "Hello! My name is Sarah and I am from Toronto, Canada. I am twenty-four years old and I work at a library. I love reading books, drinking green tea, and walking in the park every morning.",
      "I have a big family. I live with my parents and my two brothers. My father is a chef in an Italian restaurant and my mother works at a hospital. We always cook dinner together on Friday evenings.",
      "Every Saturday, I meet my best friend, John. We go to a nice café in the city center. We talk about our week, practice our Spanish, and sometimes plan short weekend trips. It is a wonderful routine."
    ]
  },
  {
    title: "Exploring the City of London",
    author: "UniversalCEFR",
    language: "en",
    cefrLevel: "A2",
    sourceType: "universal_cefr",
    description: "Поездка Сары в Лондон: экскурсии, Вестминстерский мост и традиционный паб.",
    paragraphs: [
      "Last summer, my sister and I took a trip to London. It was our first time visiting the United Kingdom, and we were very excited to see all the historic sights we had read about in books.",
      "On our first day, we bought tickets for the red double-decker bus. We visited the famous Big Ben and walked across Westminster Bridge. The view of the River Thames was beautiful, but the weather was a bit windy.",
      "For lunch, we wanted to eat something classic, so we ordered fish and chips at an old pub near Covent Garden. In the afternoon, we visited the British Museum. The building was huge and filled with treasures from ancient history.",
      "We spent our evening walking around Piccadilly Circus. The bright lights and busy streets made us feel the incredible energy of the city. London is a place where history meets modern life."
    ]
  },
  {
    title: "The Ethical Dilemmas of Artificial Intelligence",
    author: "UniversalCEFR",
    language: "en",
    cefrLevel: "C1",
    sourceType: "universal_cefr",
    description: "Аналитическое эссе о влиянии ИИ, этических алгоритмах и предвзятости данных.",
    paragraphs: [
      "As artificial intelligence systems weave themselves deeper into the fabric of modern society, the philosophical and practical questions surrounding their ethical deployment have moved from the realms of science fiction to the forefront of global policy debates.",
      "One of the most pressing concerns is algorithmic bias. Machine learning models are trained on historical data, which often reflects human prejudices. If left unchecked, these systems can perpetuate and even amplify systemic inequalities in critical areas such as hiring processes, loan evaluations, and judicial sentencing.",
      "Furthermore, the rapid rise of generative AI has sparked intense legal battles over intellectual property rights and the proliferation of sophisticated deepfakes. Safeguarding public discourse from synthetic misinformation while preserving artistic freedom and technological progress represents one of the most intricate regulatory tightropes of our age."
    ]
  }
];
