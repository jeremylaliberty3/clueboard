import "server-only";
import type { Clue } from "./types";

// MVP seed dataset. Replace later with the full jwolle1 dataset import into Postgres.
// Each single-round category has all five standard values present.

let nextId = 1;
const c = (
  category: string,
  categoryTag: string,
  value: number | null,
  clue: string,
  answer: string,
  round: "single" | "final" = "single",
): Clue => ({
  id: nextId++,
  category,
  categoryTag,
  value,
  clue,
  answer,
  round,
});

export const CLUES: Clue[] = [
  // World History
  c("World History", "History", 200, "This Italian explorer landed in the Bahamas in 1492 thinking he'd reached the Indies.", "Christopher Columbus"),
  c("World History", "History", 400, "The Berlin Wall fell in this year.", "1989"),
  c("World History", "History", 600, "This French general crowned himself emperor in 1804 in Notre Dame.", "Napoleon"),
  c("World History", "History", 800, "The Treaty of Versailles formally ended this war.", "World War I"),
  c("World History", "History", 1000, "This wonder of the ancient world was destroyed by an earthquake in 226 BC after standing only 54 years.", "Colossus of Rhodes"),

  // U.S. Presidents
  c("U.S. Presidents", "History", 200, "He was the first president of the United States.", "George Washington"),
  c("U.S. Presidents", "History", 400, "This president signed the Emancipation Proclamation in 1863.", "Abraham Lincoln"),
  c("U.S. Presidents", "History", 600, "FDR delivered fireside chats during this 1930s economic crisis.", "the Great Depression"),
  c("U.S. Presidents", "History", 800, "He resigned the presidency in 1974 following the Watergate scandal.", "Richard Nixon"),
  c("U.S. Presidents", "History", 1000, "This president, the only one to serve two non-consecutive terms before 2024, holds the 22nd & 24th slots.", "Grover Cleveland"),

  // Science
  c("Science", "Science", 200, "Symbol Au, this precious metal has atomic number 79.", "Gold"),
  c("Science", "Science", 400, "This force keeps planets in orbit around the sun.", "Gravity"),
  c("Science", "Science", 600, "DNA stands for this acid.", "Deoxyribonucleic acid"),
  c("Science", "Science", 800, "This German-born physicist published the theory of general relativity in 1915.", "Albert Einstein"),
  c("Science", "Science", 1000, "This SI unit of frequency equals one cycle per second.", "Hertz"),

  // Geography
  c("Geography", "Geography", 200, "This longest river in the world flows north through Egypt.", "the Nile"),
  c("Geography", "Geography", 400, "Mount Everest sits on the border between Nepal and this country.", "China"),
  c("Geography", "Geography", 600, "This South American country is named after the equator.", "Ecuador"),
  c("Geography", "Geography", 800, "Africa's largest country by area since 2011.", "Algeria"),
  c("Geography", "Geography", 1000, "This landlocked European microstate sits between France and Spain.", "Andorra"),

  // Movies
  c("At the Movies", "Movies", 200, "Tom Hanks famously talks to a volleyball named Wilson in this 2000 film.", "Cast Away"),
  c("At the Movies", "Movies", 400, "This 1972 mob film won Best Picture and made an offer audiences couldn't refuse.", "The Godfather"),
  c("At the Movies", "Movies", 600, "Christopher Nolan directed this 2010 dream-within-a-dream thriller starring Leonardo DiCaprio.", "Inception"),
  c("At the Movies", "Movies", 800, "Bong Joon-ho's 2019 film about class warfare became the first non-English film to win Best Picture.", "Parasite"),
  c("At the Movies", "Movies", 1000, "Orson Welles directed and starred in this 1941 film widely cited as the greatest of all time.", "Citizen Kane"),

  // Music
  c("Music", "Music", 200, "This British band's members were John, Paul, George, and Ringo.", "The Beatles"),
  c("Music", "Music", 400, "Beethoven famously wrote nine of these.", "Symphonies"),
  c("Music", "Music", 600, "This Austrian composer wrote The Magic Flute and died at 35 in 1791.", "Mozart"),
  c("Music", "Music", 800, "This American genre originated in New Orleans in the late 19th and early 20th centuries.", "Jazz"),
  c("Music", "Music", 1000, "This 1975 Queen song features an operatic middle section and runs nearly 6 minutes.", "Bohemian Rhapsody"),

  // Literature
  c("Literature", "Literature", 200, "Shakespeare's star-crossed lovers from Verona.", "Romeo and Juliet"),
  c("Literature", "Literature", 400, "This author created the boy wizard Harry Potter.", "J.K. Rowling"),
  c("Literature", "Literature", 600, "Mark Twain's 1884 novel follows this title character down the Mississippi River.", "Huckleberry Finn"),
  c("Literature", "Literature", 800, "George Orwell's dystopian novel set in a year that was three decades in the future when published.", "1984"),
  c("Literature", "Literature", 1000, "This Russian author wrote War and Peace and Anna Karenina.", "Leo Tolstoy"),

  // Sports
  c("Sports", "Sports", 200, "In tennis, a score of zero is called this.", "Love"),
  c("Sports", "Sports", 400, "This golfer has won the most career major championships in men's golf.", "Jack Nicklaus"),
  c("Sports", "Sports", 600, "The Stanley Cup is awarded annually in this sport.", "Hockey"),
  c("Sports", "Sports", 800, "Brazil has won this many men's FIFA World Cups, more than any other nation.", "5"),
  c("Sports", "Sports", 1000, "This American gymnast has won the most World Championship medals of all time.", "Simone Biles"),

  // Wordplay
  c("Wordplay", "Wordplay", 200, "A word that reads the same forwards and backwards, like 'racecar'.", "Palindrome"),
  c("Wordplay", "Wordplay", 400, "This figure of speech compares two things using 'like' or 'as'.", "Simile"),
  c("Wordplay", "Wordplay", 600, "Words like 'buzz' and 'sizzle' that sound like what they describe are this.", "Onomatopoeia"),
  c("Wordplay", "Wordplay", 800, "A 'pangram' contains every letter of this.", "the alphabet"),
  c("Wordplay", "Wordplay", 1000, "This rhetorical device places contradictory terms together, like 'deafening silence'.", "Oxymoron"),

  // Food & Drink
  c("Food & Drink", "Food", 200, "This Italian dish is a flat round bread topped with tomato sauce and cheese.", "Pizza"),
  c("Food & Drink", "Food", 400, "Sushi is traditionally made with this short-grain ingredient.", "Rice"),
  c("Food & Drink", "Food", 600, "This French sauce is one of the five 'mother sauces' and starts with a roux of butter and flour with milk.", "Béchamel"),
  c("Food & Drink", "Food", 800, "This spicy green Japanese condiment commonly served with sushi.", "Wasabi"),
  c("Food & Drink", "Food", 1000, "This Mexican drink is made from fermented blue agave and originates from a town of the same name.", "Tequila"),

  // Mythology
  c("Mythology", "Mythology", 200, "King of the Greek gods, ruler of Mount Olympus.", "Zeus"),
  c("Mythology", "Mythology", 400, "This Norse god wields the hammer Mjölnir.", "Thor"),
  c("Mythology", "Mythology", 600, "Roman name for the god of war.", "Mars"),
  c("Mythology", "Mythology", 800, "This Greek hero completed twelve labors as penance.", "Hercules"),
  c("Mythology", "Mythology", 1000, "Egyptian god of the afterlife, depicted with green skin.", "Osiris"),

  // Tech
  c("Tech", "Tech", 200, "This American company's first product was the Apple I computer in 1976.", "Apple"),
  c("Tech", "Tech", 400, "HTTP stands for Hypertext Transfer this.", "Protocol"),
  c("Tech", "Tech", 600, "This British computer scientist invented the World Wide Web in 1989.", "Tim Berners-Lee"),
  c("Tech", "Tech", 800, "This programming language, named after a coffee, was released by Sun Microsystems in 1995.", "Java"),
  c("Tech", "Tech", 1000, "This sorting algorithm, named for a British computer scientist, has average O(n log n) complexity.", "Quicksort"),

  // Animals
  c("Animals", "Animals", 200, "The largest mammal on Earth.", "Blue whale"),
  c("Animals", "Animals", 400, "A baby kangaroo is called this.", "Joey"),
  c("Animals", "Animals", 600, "This flightless Australian bird is the second-tallest living bird species.", "Emu"),
  c("Animals", "Animals", 800, "Octopuses have this many hearts.", "3"),
  c("Animals", "Animals", 1000, "This fish, the heaviest known bony fish, can weigh over 2,000 kg.", "Ocean sunfish"),

  // Capitals
  c("World Capitals", "Geography", 200, "Capital of France.", "Paris"),
  c("World Capitals", "Geography", 400, "This South Korean capital sits along the Han River.", "Seoul"),
  c("World Capitals", "Geography", 600, "Capital of Australia, often confused with Sydney.", "Canberra"),
  c("World Capitals", "Geography", 800, "This East African capital sits on a high plateau and shares its name with the country plus a suffix meaning 'place'.", "Nairobi"),
  c("World Capitals", "Geography", 1000, "Capital of Bhutan, in the Himalayas.", "Thimphu"),

  // Final clues
  c("Famous Speeches", "History", null, "In 1963, this American civil rights leader delivered a speech beginning 'I have a dream' from the Lincoln Memorial steps.", "Martin Luther King Jr.", "final"),
  c("Inventions", "Science", null, "This Scottish-born inventor patented the telephone in 1876.", "Alexander Graham Bell", "final"),
  c("Shakespeare", "Literature", null, "In this Shakespeare play, the title character sees a dagger floating before him before murdering King Duncan.", "Macbeth", "final"),
  c("Constellations", "Science", null, "Latin for 'great bear', this constellation contains the Big Dipper.", "Ursa Major", "final"),
  c("Currencies", "Geography", null, "Before adopting the euro, this country used a currency called the lira.", "Italy", "final"),
  c("Olympics", "Sports", null, "These two cities have hosted the Summer Olympics three times each as of 2024.", "London and Paris", "final"),
  c("Nobel Prizes", "Science", null, "This Polish-French physicist was the first person to win Nobel Prizes in two different sciences.", "Marie Curie", "final"),
  c("Dynasties", "History", null, "This Chinese dynasty (1368–1644) is famed for its blue-and-white porcelain.", "Ming", "final"),
];

export const SINGLE_CLUES = CLUES.filter((x) => x.round === "single");
export const FINAL_CLUES = CLUES.filter((x) => x.round === "final");

export function clueById(id: number): Clue | undefined {
  return CLUES.find((x) => x.id === id);
}
