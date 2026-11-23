/**
 * Negotiation: the book's own numbers, kept in one place.
 *
 * Draw Steel runs a parley on two tracks the Director has to hold in their
 * head — Interest (0–5, what the NPC will offer right now) and Patience
 * (0–5, how much arguing they will sit through) — plus the motivations an
 * argument can appeal to and the pitfalls that sink it. This module is the
 * printed record of those rules: the attitude table that opens a
 * negotiation, the outcome each interest level buys, the five ways an
 * argument can go, and the archetypes the Heroes book offers as ready-made
 * NPCs.
 */

// ---------- Attitudes: how a negotiation opens ----------

export type AttitudeKey = "hostile" | "suspicious" | "neutral" | "open" | "friendly" | "trusting";

export interface Attitude {
  key: AttitudeKey;
  label: string;
  interest: number;
  patience: number;
  description: string;
}

/** The Heroes book's Negotiation Starting Attitudes table, in its order. */
export const ATTITUDES: readonly Attitude[] = [
  {
    key: "hostile",
    label: "Hostile",
    interest: 1,
    patience: 2,
    description: "Openly opposed to the heroes. Barely willing to listen.",
  },
  {
    key: "suspicious",
    label: "Suspicious",
    interest: 2,
    patience: 2,
    description: "Doubts the heroes' motives but is willing to listen.",
  },
  {
    key: "neutral",
    label: "Neutral",
    interest: 2,
    patience: 3,
    description: "Would probably rather be somewhere else, but doesn't want to be rude.",
  },
  {
    key: "open",
    label: "Open",
    interest: 3,
    patience: 3,
    description:
      "Willing to listen, willing to help, as long as the heroes aren't asking too much.",
  },
  {
    key: "friendly",
    label: "Friendly",
    interest: 3,
    patience: 4,
    description: "The heroes seem like the NPC's people.",
  },
  {
    key: "trusting",
    label: "Trusting",
    interest: 3,
    patience: 5,
    description: "Has reason to take the heroes at their word.",
  },
] as const;

export function attitudeOf(key: unknown): Attitude {
  return ATTITUDES.find((attitude) => attitude.key === key) ?? (ATTITUDES[2] as Attitude);
}

// ---------- The interest ladder: what each level buys ----------

export interface InterestStep {
  value: number;
  /** The book's own phrase for the response. */
  label: string;
  /** What the NPC does at this level. */
  summary: string;
  /** The negotiation ends here. */
  terminal: boolean;
}

/** Interest 5 down to 0, as the NPC Response and Offer table reads. */
export const INTEREST_LADDER: readonly InterestStep[] = [
  {
    value: 5,
    label: "Yes, and…",
    summary: "Everything the heroes asked for, sweetened — the best offer they can make.",
    terminal: true,
  },
  {
    value: 4,
    label: "Yes.",
    summary: "Everything asked for, nothing more. Anything the heroes offered is accepted.",
    terminal: false,
  },
  {
    value: 3,
    label: "Yes, but…",
    summary: "What they want, in exchange for everything offered — plus a little extra.",
    terminal: false,
  },
  {
    value: 2,
    label: "No, but…",
    summary: "Can't give what they want. Offers lesser goods or services for what was promised.",
    terminal: false,
  },
  {
    value: 1,
    label: "No.",
    summary: "Outright rejection, no counteroffer — but still listening.",
    terminal: false,
  },
  {
    value: 0,
    label: "No, and…",
    summary: "Nothing. The negotiation is over and they mean the heroes harm.",
    terminal: true,
  },
] as const;

export function interestStep(value: number): InterestStep {
  return (
    INTEREST_LADDER.find((step) => step.value === value) ?? (INTEREST_LADDER[3] as InterestStep)
  );
}

// ---------- Motivations and pitfalls ----------

export interface Trait {
  key: string;
  label: string;
  /** One line on what this trait means as a motivation. */
  gloss: string;
  /** One line on why this trait backfires as a pitfall. */
  pitfallGloss: string;
}

/** The book's twelve motivations (and their mirror-image pitfalls), each in
    one line — enough for the Director to place an argument at the table. */
export const TRAITS: readonly Trait[] = [
  {
    key: "benevolence",
    label: "Benevolence",
    gloss: "Shares what they have; pities the helpless.",
    pitfallGloss: "Cynical about charity; scorns bleeding-heart pleas.",
  },
  {
    key: "discovery",
    label: "Discovery",
    gloss: "Wants lore, lost places and new ideas.",
    pitfallGloss: "Distrusts the unknown, meddling, or unproven ideas.",
  },
  {
    key: "freedom",
    label: "Freedom",
    gloss: "Answers to no one, and wants no one under them.",
    pitfallGloss: "Sees unchecked freedom as chaos; expects order.",
  },
  {
    key: "greed",
    label: "Greed",
    gloss: "Wealth and resources above almost anything else.",
    pitfallGloss: "Insulted by bribes or appeals to mere coin.",
  },
  {
    key: "higher-authority",
    label: "Higher authority",
    gloss: "Loyal to a liege, a god, an institution.",
    pitfallGloss: "Resents titles, institutions, and blind obedience.",
  },
  {
    key: "justice",
    label: "Justice",
    gloss: "Wants the righteous rewarded and the wicked punished.",
    pitfallGloss: "Scoffs at moralizing, laws, and righteous lectures.",
  },
  {
    key: "legacy",
    label: "Legacy",
    gloss: "Wants to be remembered, and fears being forgotten.",
    pitfallGloss: "Distrusts vanity, glory-seeking, and grand promises.",
  },
  {
    key: "peace",
    label: "Peace",
    gloss: "Wants calm, and to be left alone to keep it.",
    pitfallGloss: "Sees pacifism or compromise as weakness.",
  },
  {
    key: "power",
    label: "Power",
    gloss: "Covets authority and wants more of it.",
    pitfallGloss: "Despises coercion, ambition, and power plays.",
  },
  {
    key: "protection",
    label: "Protection",
    gloss: "Has land, kin or an organization to keep safe.",
    pitfallGloss: "Unmoved by pleas to shelter or defend others.",
  },
  {
    key: "revelry",
    label: "Revelry",
    gloss: "Lives for pleasure, company and spectacle.",
    pitfallGloss: "Finds indulgence, flattery, and spectacle frivolous.",
  },
  {
    key: "vengeance",
    label: "Vengeance",
    gloss: "Wants to pay back someone who wronged them.",
    pitfallGloss: "Repelled by grudges, cruelty, and blood-feuds.",
  },
] as const;

export function traitOf(key: unknown): Trait {
  const found = TRAITS.find((trait) => trait.key === key);
  if (found) return found;
  const label = String(key ?? "").trim();
  return { key: label, label: label || "Motivation", gloss: "", pitfallGloss: "" };
}

/** The trait behind a motivation's printed name, so an archetype's list
    carries the book's gloss. */
export function traitByLabel(name: unknown): Trait | null {
  const label = String(name ?? "")
    .trim()
    .toLowerCase();
  return TRAITS.find((trait) => trait.label.toLowerCase() === label) ?? null;
}

/** The right one-line book gloss for whether the trait is a motivation or pitfall. */
export function traitGloss(name: unknown, kind: "motivation" | "pitfall"): string {
  const trait = traitByLabel(name);
  if (!trait) return "";
  return kind === "pitfall" ? trait.pitfallGloss : trait.gloss;
}

/** The book's archetype-specific quote for this trait when available,
    falling back to the general motivation or pitfall gloss. */
export function traitDescription(
  archetypeKey: unknown,
  name: unknown,
  kind: "motivation" | "pitfall",
): string {
  const archetype = archetypeOf(archetypeKey);
  const trait = traitByLabel(name);
  if (archetype && trait) {
    const quote =
      kind === "pitfall" ? archetype.pitfallNotes[trait.key] : archetype.motivationNotes[trait.key];
    if (quote) return quote;
  }
  return traitGloss(name, kind);
}

/** Deal non-overlapping official traits for fast mid-session improvisation. */
export function randomTraitPair(
  motivationCount = 3,
  pitfallCount = 2,
): { motivations: Trait[]; pitfalls: Trait[] } {
  const pool = [...TRAITS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  const m = Math.min(motivationCount, pool.length);
  const p = Math.min(pitfallCount, pool.length - m);
  return {
    motivations: pool.slice(0, m),
    pitfalls: pool.slice(m, m + p),
  };
}

export type ImpressionBandKey = "local" | "civic" | "mythic";

export interface ImpressionBand {
  key: ImpressionBandKey;
  label: string;
  range: string;
  min: number;
  max: number;
  defaultImpression: number;
  npcName: string;
  hint: string;
}

/** Three stakes bands matching the Heroes book's Impression ladder, used to
    group archetypes and deal instant mid-session NPCs in one tap. */
export const IMPRESSION_BANDS: readonly ImpressionBand[] = [
  {
    key: "local",
    label: "Local",
    range: "Impression 1–4",
    min: 1,
    max: 4,
    defaultImpression: 2,
    npcName: "Local NPC",
    hint: "Innkeeper, brigand chief, guild contact, local lord",
  },
  {
    key: "civic",
    label: "Civic & Noble",
    range: "Impression 5–8",
    min: 5,
    max: 8,
    defaultImpression: 6,
    npcName: "Notable NPC",
    hint: "Watch captain, burgomaster, high priest, royal duke",
  },
  {
    key: "mythic",
    label: "Mythic",
    range: "Impression 9–12",
    min: 9,
    max: 12,
    defaultImpression: 10,
    npcName: "Legendary NPC",
    hint: "Dragon, monarch, archmage, lich, deity",
  },
] as const;

export function impressionBandOf(key: ImpressionBandKey): ImpressionBand {
  return IMPRESSION_BANDS.find((band) => band.key === key) ?? IMPRESSION_BANDS[0]!;
}

// ---------- Archetypes: ready-made NPCs from the Heroes book ----------

export interface Archetype {
  key: string;
  label: string;
  impression: number;
  motivations: readonly string[];
  pitfalls: readonly string[];
  /** Concise 1-line summary for the archetype picker index. */
  note: string;
  /** The Heroes book's italicized roleplay summary of how this NPC negotiates. */
  summary: string;
  /** The Heroes book's adaptation note ("can be used for any other..."). */
  usedFor: string;
  /** The Heroes book's per-trait quotes for this archetype's motivations. */
  motivationNotes: Readonly<Record<string, string>>;
  /** The Heroes book's per-trait quotes for this archetype's pitfalls. */
  pitfallNotes: Readonly<Record<string, string>>;
}

/** The book's twelve NPC archetypes. Each carries four possible motivations and
    four possible pitfalls with their in-character voice quotes, plus an
    Impression score that sets how much Renown it takes to move them. */
export const ARCHETYPES: readonly Archetype[] = [
  {
    key: "bandit-chief",
    label: "Bandit chief",
    impression: 1,
    motivations: ["freedom", "greed", "power", "revelry"],
    pitfalls: ["higher-authority", "justice", "legacy", "peace"],
    note: "Local big shot — privileged child of a local lord, arrogant tavern darts champion, or any bully.",
    summary:
      "The bandit chief is a bully and a braggart, typically negotiating using intimidation and bluster before softening.",
    usedFor:
      "The bandit chief archetype can be used for any other local big shot, such as the privileged child of a local lord, an arrogant tavern darts champion, or any bully.",
    motivationNotes: {
      freedom:
        "No one tells me what to do—not if they want to keep their head on their shoulders. And no one tells my toughs what to do except *me*!",
      greed:
        "Gold! I love the feel of shining, clinking coins running between my fingers. I never found anything to spend it on that I like as much as just *having* gold.",
      power:
        "I want a stronger hideout, more toughs, and a bigger share of the loot. Get me that, and I'll do your dirty work for you.",
      revelry: "If you don't get drunk after a raid, then why have a raid?",
    },
    pitfallNotes: {
      "higher-authority":
        "By order of the baron? You can keep your fancy titles and lands. I give the orders around here!",
      justice: "Only the weak whine for justice. The strong make their own rules.",
      legacy:
        "Listen, I don't care what happens when I'm gone. I want my followers shouting my name now, not in a hundred years.",
      peace:
        "In times of peace, if you pick up a silver coin that's not yours, the sheriff comes knocking on your door. In war, whole caravans disappear and nobody blinks. Give me war.",
    },
  },
  {
    key: "knight",
    label: "Knight",
    impression: 2,
    motivations: ["higher-authority", "justice", "peace", "revelry"],
    pitfalls: ["benevolence", "freedom", "power", "vengeance"],
    note: "Local authority — village elder, town guard officer, or academic professor.",
    summary:
      "Although not always an idealist, the knight is a loyal servant of their liege and a stickler for duty. A knight knows their place in a regimented society, and believes that everyone else should keep to their own place.",
    usedFor:
      "The knight archetype can be used for any other local authority, such as a village elder, town guard officer, or academic professor.",
    motivationNotes: {
      "higher-authority":
        "That's above my pay grade. If my superiors sign off on it, then so do I.",
      justice:
        "Thank you for bringing this to my attention. I agree, this must be put right. The only question is how.",
      peace:
        "People like us, we fight so that the common folk don't have to. If I must, I'll draw my sword again to keep the peace.",
      revelry: "Every agreement should be sealed with a toast. Huzzah!",
    },
    pitfallNotes: {
      benevolence:
        "These people don't need charity, they need order. Let them go to the town hall and they'll get a full belly in exchange for an honest day's work.",
      freedom:
        "None of us are free, from the lowliest servant on up. Even a monarch has a duty to their people.",
      power: "My power comes to me through my lawful oath, not by some dirty deal made in secret.",
      vengeance:
        "I believe in law, not vengeance, and law is decided by higher courts. I'm just a functionary.",
    },
  },
  {
    key: "guildmaster",
    label: "Guildmaster",
    impression: 3,
    motivations: ["benevolence", "discovery", "power", "protection"],
    pitfalls: ["higher-authority", "justice", "peace", "revelry"],
    note: "Local information broker — cult leader, hag, or spy.",
    summary:
      "The guildmaster knows the value of a coin, but understands that knowledge—inside information and trade secrets alike—is the most valuable currency. They bargain accordingly.",
    usedFor:
      "The guildmaster archetype can be used for any other local information broker, such as a cult leader, hag, or spy.",
    motivationNotes: {
      benevolence:
        "The people can't take care of themselves. Somebody's got to look after them, the poor lambs.",
      discovery:
        "It would be highly unethical for you to show me those schematics you obtained from a rival guild. Likewise, it would be highly unethical for me to slide you this bag of gold.",
      power:
        "Who do you think will be in charge in the next age? The nobles? Pah! They still count their wealth in cows. Whoever controls information will rule the world—and I intend for that to be us.",
      protection:
        "We have rivals—hungry opportunists who will stop at nothing. If I want to protect my guild, I've got to do unto them before they do unto us.",
    },
    pitfallNotes: {
      "higher-authority":
        "My loyalty is to the guild—not the burgomaster, not the king, not Ajax himself. But don't tell them I said that.",
      justice:
        "We're reshaping the world here. Of course, some people who can't adapt are going to find themselves on the bottom. But why should anyone blame us for that?",
      peace:
        "Conflict isn't bad in and of itself. It drives innovation. The key is to not be on the losing side.",
      revelry:
        "I don't have time for this foolishness. Come talk to me again when you have something of value to show me.",
    },
  },
  {
    key: "warlord",
    label: "Warlord",
    impression: 4,
    motivations: ["freedom", "legacy", "peace", "vengeance"],
    pitfalls: ["benevolence", "discovery", "justice", "protection"],
    note: "Local-level threat — vampire, hobgoblin bloodlord, or rebellious noble.",
    summary:
      "The warlord has raised their banner and troops flock to their cause. Some say a warlord never negotiates, but that's not true. They're happy to listen to terms of surrender.",
    usedFor:
      "The warlord archetype can be used for any other local-level threat, such as a vampire, hobgoblin bloodlord, or rebellious noble.",
    motivationNotes: {
      freedom:
        "I'm not paying a single coin to some weakling liege lord for the privilege of being told what to do. I've raised my banner. I defy anyone to pull it down.",
      legacy:
        "Did you see that young captain out there putting the fear of the gods into her troops? That's my kid, but she earned her title. Someday, this will all be hers.",
      peace:
        "Look around you. Everywhere you look—weakness, corruption, waste. Peace is a noble goal, but we won't have peace until the current regime is swept away.",
      vengeance:
        "Have you suffered as I have at the hands of that accursed villain? If so, then I'll gladly call you friend.",
    },
    pitfallNotes: {
      benevolence:
        "Go back to your street corner and beg for alms if that's what you're after. You'll get nothing from me.",
      discovery: "What does that have to do with me? I'm a soldier, not a scholar.",
      justice:
        "You dare call me unjust? I make the laws here. Justice is mine to give or take away!",
      protection:
        "I'm not some sniveling coward who begs for protection, and neither are my troops. Anyone who asks for safety doesn't deserve it.",
    },
  },
  {
    key: "burgomaster",
    label: "Burgomaster",
    impression: 5,
    motivations: ["greed", "higher-authority", "justice", "protection"],
    pitfalls: ["discovery", "freedom", "revelry", "vengeance"],
    note: "Local ruler — baron, governor, or watch captain in a metropolis.",
    summary:
      "The burgomaster's power comes from their constituents, and for the most part, they aim to serve their people. Most burgomasters are experienced negotiators, never giving up any more than they mean to.",
    usedFor:
      "The burgomaster archetype can be used for any other local ruler, such as a baron, governor, or a watch captain in a metropolis.",
    motivationNotes: {
      greed:
        "Keep talking. I'm sure we can come to an agreement that benefits all parties. A rising tide and all that.",
      "higher-authority":
        "No one can accuse me of being disloyal. What my duty demands, I do—but let's determine the most sensible way to go about it.",
      justice:
        "The rule of law must be preserved. If you have evidence of crimes, those responsible must be punished.",
      protection:
        "The weak, the helpless—they depend upon me. And, to a lesser extent, civic-minded heroes like yourselves. Together, we'll make sure the people come to no harm.",
    },
    pitfallNotes: {
      discovery: "Trust me. No good is going to come from poking that particular beehive.",
      freedom:
        "Freedom, eh? What's next, freedom from taxes? No one is born free except the gods, and only fools believe otherwise.",
      revelry:
        "Put that bottle away. I'm a public figure! I can't be seen carousing and gallivanting and who knows what else.",
      vengeance:
        "In politics, you have to have a short memory. Your enemy today might be your ally tomorrow. There's no need to make things personal.",
    },
  },
  {
    key: "virtuoso",
    label: "Virtuoso",
    impression: 6,
    motivations: ["freedom", "legacy", "peace", "revelry"],
    pitfalls: ["greed", "power", "protection", "vengeance"],
    note: "Local celebrity — master crafter, inspired artist, famous gladiator, or world champion.",
    summary:
      "The virtuoso is the preeminent musician in the land—perhaps a celebrated opera singer or composer. If you need a cause popularized or an enemy's name tarnished, you come to them.",
    usedFor:
      "The virtuoso archetype can be used for any other local celebrity, such as a master crafter, inspired artist, famous gladiator, or world champion.",
    motivationNotes: {
      freedom: "I follow my muse, my only master. Who would dare put handcuffs on art?",
      legacy:
        "Castles will crumble. Empires will fall. But if only I can produce a work worthy of my talents, my name will live forever.",
      peace:
        "In war, bronze statues are melted down for armor. Money is wasted on ballistae instead of ballads. War is a crime against the god of art.",
      revelry:
        "Yes, tonight let us celebrate! Inspiration looks down kindly on those who drink life to the dregs.",
    },
    pitfallNotes: {
      greed:
        "You offer me money? Money comes to geniuses—it is our due. I can get it from a thousand admirers.",
      power:
        "I have no ambitions beyond this opera house. For me to leave this place, even for a palace or a throne... it would be an exile for me.",
      protection: "I'm not afraid. The god of music will look after her own.",
      vengeance:
        "Perhaps there are some who hate me—those who think I stand in their way, or whose accomplishments I have eclipsed. But I hate no one and am jealous of no one.",
    },
  },
  {
    key: "high-priest",
    label: "High priest",
    impression: 7,
    motivations: ["benevolence", "discovery", "higher-authority", "justice"],
    pitfalls: ["greed", "legacy", "power", "revelry"],
    note: "National authority — count, judge, or general.",
    summary:
      "The high priest might be a high-ranking member of their faith, but as they are quick to tell you, that doesn't make them free to act as they wish. The commands of their deity must be paramount.",
    usedFor:
      "The high priest archetype can be used for any other national authority, such as a count, judge, or general.",
    motivationNotes: {
      benevolence:
        "We are agreed on this matter. If this threat puts people in danger, we must come to their rescue.",
      discovery:
        "Why, yes... I would be interested in looking at that document further. Surely no harm can come from being aware of the snares and dangers in the world.",
      "higher-authority":
        "Indeed, my appointed duty is to serve all folk whether it be my deity, my liege, or the poorest person crying out in need.",
      justice:
        "Rest assured, the good will receive their just reward and the evil will be punished. I will see to it.",
    },
    pitfallNotes: {
      greed: "Don't offer that to me. Donate it to the faith if you have no need of it.",
      legacy:
        "Me? I am no one. Any good deeds I might have accomplished are to my deity's credit, not my own.",
      power: "My current responsibilities are quite enough. I have no desire for more.",
      revelry: "For shame! Do you boast of doing evil and expect me to join you in it?",
    },
  },
  {
    key: "duke",
    label: "Duke",
    impression: 8,
    motivations: ["discovery", "higher-authority", "peace", "vengeance"],
    pitfalls: ["benevolence", "greed", "justice", "protection"],
    note: "Royal counselor — archmage, spymaster, vizier, or beloved jester.",
    summary:
      "As the duke gestures you to join them at their card table, spies whisper in their ear. The duke never plays a game or enters a negotiation unless they think they can gain the high card.",
    usedFor:
      "The duke archetype can be used for any other royal counselor, such as an archmage, spymaster, vizier, or even a beloved jester.",
    motivationNotes: {
      discovery:
        "My agents have brought me many whispers, but this is news to me. Who else knows of this?",
      "higher-authority":
        "I must do as my liege commands. So tell me how you seek to serve them as well.",
      peace: "We must have stability. I will sacrifice anything—and anyone—for this.",
      vengeance:
        "There is one—I will not speak their name—who thinks I have forgotten what they did to me. Someday they will discover that I have a long memory.",
    },
    pitfallNotes: {
      benevolence:
        "Do you think I act because I love my fellow people? Half of them are worthless, and the other half are villains. But without them, I'd be the Duke of Nothing, so I must preserve them.",
      greed: "Put away your gold. I'm far too busy to spend it.",
      justice:
        "Right and wrong? There is no right except what strengthens the kingdom, and there is no wrong except what hurts it.",
      protection:
        "I don't care about saving lives. We're all doomed to die. The question is, what will live on after us?",
    },
  },
  {
    key: "dragon",
    label: "Dragon",
    impression: 9,
    motivations: ["freedom", "greed", "protection", "vengeance"],
    pitfalls: ["legacy", "peace", "power", "revelry"],
    note: "Kingdom-level threat — fire giant chief, contender for a throne, or Lord Syuul.",
    summary:
      "The dragon's tremendous might is overshadowed only by their boundless ambition and pride.",
    usedFor:
      "The dragon archetype can be used for any other kingdom-level threat, such as a fire giant chief, a contender for a throne, or the dread synliroi Lord Syuul.",
    motivationNotes: {
      freedom:
        "Yes, my ambitions have been bound to the earth for far too long. It's time I took flight.",
      greed: "Bring me tribute now, and when I rule, I will not forget you.",
      protection: "My people have been mistreated for centuries. It ends now!",
      vengeance: "This land, these people, their treasures, all rightfully mine. Stolen from me!",
    },
    pitfallNotes: {
      legacy:
        "No heir will outlive me, no legend will remember my past glory... for I shall never die!",
      peace:
        "You want to make peace? When there are still things in the world that are not yet mine?",
      power: "How can *you* possibly offer *me* power?",
      revelry: "My pleasures are as far beyond your comprehension as yours are to a worm.",
    },
  },
  {
    key: "monarch",
    label: "Monarch",
    impression: 10,
    motivations: ["benevolence", "greed", "justice", "legacy"],
    pitfalls: ["discovery", "freedom", "higher-authority", "vengeance"],
    note: "Kingdom-level ruler — tyrant, theocracy's archpriest, or republic's consul.",
    summary:
      "Whether they're good or evil, a monarch is accustomed to authority and wants to keep it. They respond better to pleas than to demands.",
    usedFor:
      "The monarch archetype can be used for any other kingdom-level ruler, such as a tyrant, a theocracy's archpriest, or a republic's consul.",
    motivationNotes: {
      benevolence: "It's not for nothing I'm called \"the Good.\"",
      greed: "Your offer intrigues me. In truth, our coffers are not as full as I should like.",
      justice: "Ah, do the villains ignore my laws? They must be punished!",
      legacy:
        "If I should die, promise me this: You will serve my heir as loyally as you have served me.",
    },
    pitfallNotes: {
      discovery: "Keep your secrets to yourself. I'm a monarch, not a spymaster.",
      freedom:
        "Freedom? Some of my disloyal subjects speak that word a little too often for my liking. I hope you're not one of them.",
      "higher-authority":
        "You dare give orders to me? Never forget, no matter who sent you, I rule here!",
      vengeance:
        "Revenge is an exciting sport. Sadly, it's one I've had to give up. It's policy, not revenge, that rules here.",
    },
  },
  {
    key: "lich",
    label: "Lich",
    impression: 11,
    motivations: ["discovery", "power", "revelry", "vengeance"],
    pitfalls: ["benevolence", "legacy", "peace", "protection"],
    note: "World-shaking threat — would-be emperor or vampire lord Count Rhodar von Glauer.",
    summary:
      "The lich spent centuries alone, studying and building their power... but now the time for studying is over.",
    usedFor:
      "The lich is willing to negotiate with strong heroes who might make loyal lieutenants—or powerful undead servants if the talks don't go well. The lich archetype can be used for any other world-shaking threat, such as a would-be emperor or the vampire lord Count Rhodar von Glauer.",
    motivationNotes: {
      discovery: "Give me that book at once! Your very touch corrupts it.",
      power: "Yes... yes... power! Ahahahaha! Bring me this power and you will be rewarded.",
      revelry:
        "Join my court for the coming feast! We shall know such entertainments as were never seen in this world before.",
      vengeance: "The world despised me... banished me... forgot me. The world shall regret it.",
    },
    pitfallNotes: {
      benevolence: "Do you ask the farmer to pity the wheat before it's harvested?",
      legacy:
        "I don't care what the common people think of me. The less they think of me, the better—as long as they obey my commands.",
      peace: "Yes, yes, peace will come... but not now.",
      protection:
        "If you're so intent on saving lives, then save your own by bowing down before me! No harm will come to my servants.",
    },
  },
  {
    key: "deity",
    label: "Deity",
    impression: 12,
    motivations: ["benevolence", "legacy", "power", "protection"],
    pitfalls: ["discovery", "freedom", "greed", "higher-authority"],
    note: "World-transcending power — time dragon Cthrion Uroniziir or dread pharaoh Khorsekef the Infinite.",
    summary:
      "The deity will listen to your prayers—and might perhaps answer them as well, if the mood strikes them.",
    usedFor:
      "The deity archetype can be used for any other world-transcending power, such as the legendary time dragon Cthrion Uroniziir, or the dread pharaoh Khorsekef the Infinite.",
    motivationNotes: {
      benevolence:
        "Worry not, for I have sent champions to save the world. Perhaps these champions... are closer than you think.",
      legacy:
        "When that blessed day arrives, all shall come before me to pray, and I shall offer my blessings to the world!",
      power:
        "Although I am all-powerful on the spiritual realm, my hands are bound in such worldly matters. But if you act for me, I can offer a little assistance.",
      protection: "Have faith, little one... none will be forgotten or left behind.",
    },
    pitfallNotes: {
      discovery: "Mortal, what can you tell me that I do not know?",
      freedom:
        "True freedom lies in service to me. Surrender your freedom and I shall raise you up high.",
      greed: "Fool! Do you seek to offer me what is already mine?",
      "higher-authority":
        "Who do you speak of? Who is beyond me, who is above me? Who will live to see me die, and who drew breath before I gave it? Let them come forth and say their name!",
    },
  },
] as const;

export function archetypeOf(key: unknown): Archetype | null {
  return ARCHETYPES.find((archetype) => archetype.key === key) ?? null;
}

/** The book's example NPCs for each Impression score. */
export const IMPRESSION_EXAMPLES: readonly string[] = [
  "",
  "Brigand leader, commoner, shop owner",
  "Knight, local guildmaster, professor",
  "Cult leader, locally known mage, noble lord",
  "Assassin, baron, locally famous entertainer",
  "Captain of the watch in a large city, high priest, viscount",
  "Count, warlord",
  "Marquis, world-renowned entertainer",
  "Duke, spymaster",
  "Archmage, prince",
  "Demon lord, monarch",
  "Archdevil, archfey, demigod",
  "Deity, titan",
] as const;

// ---------- Arguments ----------

export type ArgumentKind = "motivation" | "plain" | "pitfall" | "used-motivation" | "repeat";

/** One tier's movement on the two tracks. */
interface Tier {
  interest: number;
  patience: number;
}

/** What each power-roll tier moves, as deltas. A kind that never rolls
    repeats one table across all three rows, so the panel prints its rows
    the same way whether the dice were called for or not. */
const OUTCOME_TABLES: Record<ArgumentKind, readonly [Tier, Tier, Tier]> = {
  // A fresh motivation: a medium test, and the best argument costs no patience.
  motivation: [
    { interest: 0, patience: -1 },
    { interest: 1, patience: -1 },
    { interest: 1, patience: 0 },
  ],
  // No motivation and no pitfall: a more difficult test. A natural 19 or 20
  // holds the NPC's patience on the top tier.
  plain: [
    { interest: -1, patience: -1 },
    { interest: 0, patience: -1 },
    { interest: 1, patience: -1 },
  ],
  // A pitfall fails outright, whatever the dice would have said.
  pitfall: [
    { interest: -1, patience: -1 },
    { interest: -1, patience: -1 },
    { interest: -1, patience: -1 },
  ],
  // A motivation already appealed to moves nothing but patience.
  "used-motivation": [
    { interest: 0, patience: -1 },
    { interest: 0, patience: -1 },
    { interest: 0, patience: -1 },
  ],
  // The same motivationless argument again: a tier 1 outcome by rule.
  repeat: [
    { interest: -1, patience: -1 },
    { interest: -1, patience: -1 },
    { interest: -1, patience: -1 },
  ],
};

const deltaLines = (
  kind: ArgumentKind,
  tier: 1 | 2 | 3,
  lie = false,
  natural = false,
): string[] => {
  const base = OUTCOME_TABLES[kind][tier - 1] as Tier;
  const naturalHolds = kind === "plain" && tier === 3 && natural;
  const patience = naturalHolds ? 0 : base.patience;
  const lines: string[] = [];
  if (base.interest) lines.push(`Interest ${base.interest > 0 ? "+1" : "−1"}`);
  // A lie bites only where the argument failed to raise interest, which is
  // what the applier charges — the row you tap and the log can never differ.
  if (lie && base.interest <= 0) lines.push("The lie: interest −1");
  lines.push(patience ? "Patience −1" : "Patience unchanged");
  return lines;
};

export interface ArgumentPlan {
  kind: ArgumentKind;
  /** Short heading for what the hero is doing. */
  title: string;
  /** Why this argument goes the way it does. */
  hint: string;
  /** The power roll it needs, or null when no roll is called for. */
  roll: "medium" | "hard" | null;
  /** A natural 19 or 20 also holds the NPC's patience. */
  naturalHoldsPatience: boolean;
}

export interface ArgumentMark {
  /** The motivation this argument appeals to, or null. */
  motivation: string | null;
  /** The argument mentions one of the NPC's pitfalls. */
  pitfall: boolean;
  /** The same argument as the last one, with no motivation behind it. */
  repeat: boolean;
  /** The motivation was already appealed to earlier in this negotiation. */
  usedMotivation: boolean;
  /** The NPC catches the hero in a lie. */
  lie: boolean;
}

/** What one tier prints, with everything the Director marked on it. The
    argument, the row and the log all read from here, so what the table is
    shown before the dice is exactly what is charged afterwards. */
export function tierLines(
  kind: ArgumentKind,
  tier: 1 | 2 | 3,
  lie = false,
  natural = false,
): readonly string[] {
  return deltaLines(kind, tier, lie, natural);
}

/**
 * What an argument is, from how the Director marked it. This is the whole
 * decision the table has to make, and it happens before the dice: a pitfall
 * or an already-used motivation never rolls at all.
 */
export function planArgument(mark: ArgumentMark): ArgumentPlan {
  const kind = kindOf(mark);
  switch (kind) {
    case "pitfall":
      return {
        kind,
        title: "Touched a pitfall",
        hint: "The argument fails outright: the NPC's interest and patience each drop by 1, and they warn the heroes off.",
        roll: null,
        naturalHoldsPatience: false,
      };
    case "used-motivation":
      return {
        kind,
        title: "Reused a motivation",
        hint: "This motivation has already been appealed to. The NPC is unmoved, and their patience drops by 1.",
        roll: null,
        naturalHoldsPatience: false,
      };
    case "motivation":
      return {
        kind,
        title: "Appeals to a motivation",
        hint: "A medium test, because the argument touches something the NPC cares about.",
        roll: "medium",
        naturalHoldsPatience: false,
      };
    case "repeat":
      return {
        kind,
        title: "The same argument again",
        hint: "Repeating an argument with no motivation behind it obtains a tier 1 outcome outright.",
        roll: null,
        naturalHoldsPatience: false,
      };
    default:
      return {
        kind,
        title: "An argument with no motivation",
        hint: "A more difficult test: the argument offers the NPC nothing they care about.",
        roll: "hard",
        naturalHoldsPatience: true,
      };
  }
}

function kindOf(mark: ArgumentMark): ArgumentKind {
  if (mark.pitfall) return "pitfall";
  if (mark.motivation && mark.usedMotivation) return "used-motivation";
  if (mark.motivation) return "motivation";
  if (mark.repeat) return "repeat";
  return "plain";
}

export interface TierOutcome {
  interest: number;
  patience: number;
  /** A natural 19 or 20 held the NPC's patience on the plain argument. */
  natural: boolean;
}

/** The interest and patience a tier moves, as deltas. */
export function tierOutcome(plan: ArgumentPlan, tier: 1 | 2 | 3, natural = false): TierOutcome {
  const base = OUTCOME_TABLES[plan.kind][tier - 1] as Tier;
  const naturalHolds = plan.kind === "plain" && tier === 3 && natural;
  return {
    interest: base.interest,
    patience: naturalHolds ? 0 : base.patience,
    natural: naturalHolds,
  };
}

/** A lie only bites when the argument failed to raise the NPC's interest. */
export function lieBites(outcome: { interest: number }): boolean {
  return outcome.interest <= 0;
}

/** The two tracks after an argument, clamped to the book's 0–5. */
export function applyOutcome(
  interest: number,
  patience: number,
  outcome: { interest: number; patience: number },
): { interest: number; patience: number } {
  return {
    interest: clamp(interest + outcome.interest, 0, 5),
    patience: clamp(patience + outcome.patience, 0, 5),
  };
}

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

// ---------- Reading the NPC ----------

export interface ProbePlan {
  title: string;
  hint: string;
  /** What each tier learns, in the same shape the argument's tier rows print:
      what the test finds, then what it moves. */
  tiers: readonly [readonly string[], readonly string[], readonly string[]];
}

/** The Director's read on the NPC: asking outright, or watching for what
    they reach for. One test per argument, until the heroes argue again. */
export const PROBE_PLAN: ProbePlan = {
  title: "Read the NPC",
  hint: "Asking outright, or watching for what they reach for. Once between arguments, until the heroes argue again.",
  tiers: [
    ["Learns nothing", "The NPC notices the probing, patience −1"],
    ["Learns nothing"],
    ["Learns one motivation or pitfall, the hero's choice"],
  ],
};

/** The read is once between arguments: the dice wait until the heroes have
    argued again. The log is newest-first, so a read sitting on its head is
    a read that no argument has answered yet. */
export function readSpent(log: readonly { kind: "argument" | "read" }[]): boolean {
  return log[0]?.kind === "read";
}

// ---------- Ending a negotiation ----------

export type Ending = "interest-5" | "interest-0" | "patience-0" | null;

/** Which end of the negotiation the two tracks have reached, if any. */
export function endingFor(interest: number, patience: number): Ending {
  if (interest >= 5) return "interest-5";
  if (interest <= 0) return "interest-0";
  if (patience <= 0) return "patience-0";
  return null;
}

export function endingText(ending: Ending): { label: string; detail: string } | null {
  switch (ending) {
    case "interest-5":
      return {
        label: "Final offer",
        detail:
          "Interest 5: the NPC offers everything asked for, and sweetens it. The negotiation ends here.",
      };
    case "interest-0":
      return {
        label: "No deal",
        detail:
          "Interest 0: they offer nothing, refuse to negotiate further, and mean the heroes harm.",
      };
    case "patience-0":
      return {
        label: "Patience gone",
        detail: "Patience 0: the NPC makes their final offer, and the negotiation ends.",
      };
    default:
      return null;
  }
}
