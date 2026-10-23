/* Built-in question sets for Quiz Show. Each set: 5 categories x 5 questions (values 100..500, easiest first). */
window.QUIZ_SETS = [
  {
    id: 'general',
    name: 'General (ages 9–13)',
    categories: [
      {
        name: 'Science',
        questions: [
          { q: 'Which planet is known as the Red Planet?', a: 'Mars' },
          { q: 'Which gas do plants take in from the air to make their food?', a: 'Carbon dioxide (CO₂)' },
          { q: 'At what temperature does water boil at sea level, in degrees Celsius?', a: '100 °C' },
          { q: 'What is the chemical symbol for gold?', a: 'Au' },
          { q: 'How many bones are there in the adult human body?', a: '206' },
        ],
      },
      {
        name: 'Maths',
        questions: [
          { q: 'How many sides does a hexagon have?', a: '6' },
          { q: 'What is 7 × 8?', a: '56' },
          { q: 'What is 25% of 200?', a: '50' },
          { q: 'What is the square root of 144?', a: '12' },
          { q: 'What is the smallest prime number greater than 20?', a: '23' },
        ],
      },
      {
        name: 'Geography',
        questions: [
          { q: 'How many continents are there on Earth?', a: '7' },
          { q: 'What is the largest ocean on Earth?', a: 'The Pacific Ocean' },
          { q: 'What is the capital city of Japan?', a: 'Tokyo' },
          { q: 'Which river flows through the city of Cairo in Egypt?', a: 'The Nile' },
          { q: 'What is the capital city of Australia?', a: 'Canberra' },
        ],
      },
      {
        name: 'English',
        questions: [
          { q: 'What is the plural of “child”?', a: 'Children' },
          { q: 'What is the opposite of “ancient”?', a: 'Modern' },
          { q: 'Which of these words is a noun: run, happy, table, quickly?', a: 'Table' },
          { q: 'What is the past tense of “swim”?', a: 'Swam' },
          { q: 'What do we call words that sound the same but have different meanings, like “sea” and “see”?', a: 'Homophones' },
        ],
      },
      {
        name: 'General Knowledge',
        questions: [
          { q: 'What colour do you get when you mix blue and yellow paint?', a: 'Green' },
          { q: 'How many days are there in a leap year?', a: '366' },
          { q: 'How many players does a football (soccer) team have on the field at one time?', a: '11' },
          { q: 'What is the hardest natural substance on Earth?', a: 'Diamond' },
          { q: 'Who painted the Mona Lisa?', a: 'Leonardo da Vinci' },
        ],
      },
    ],
  },
  {
    id: 'junior',
    name: 'Junior (ages 5–8)',
    categories: [
      {
        name: 'Animals',
        questions: [
          { q: 'Which animal says “moo”?', a: 'A cow' },
          { q: 'How many legs does a spider have?', a: '8' },
          { q: 'What does a caterpillar turn into?', a: 'A butterfly (or a moth)' },
          { q: 'What is a baby frog called?', a: 'A tadpole' },
          { q: 'What is the biggest animal in the world?', a: 'The blue whale' },
        ],
      },
      {
        name: 'Numbers',
        questions: [
          { q: 'What is 2 + 3?', a: '5' },
          { q: 'How many days are there in a week?', a: '7' },
          { q: 'What is 10 − 4?', a: '6' },
          { q: 'What number comes after 99?', a: '100' },
          { q: 'How many minutes are there in one hour?', a: '60' },
        ],
      },
      {
        name: 'Colours & Shapes',
        questions: [
          { q: 'What colour is a ripe banana?', a: 'Yellow' },
          { q: 'How many sides does a triangle have?', a: '3' },
          { q: 'Which shape has 4 equal sides and 4 corners?', a: 'A square' },
          { q: 'What colour do you get when you mix red and white paint?', a: 'Pink' },
          { q: 'How many colours are there in a rainbow?', a: '7 (red, orange, yellow, green, blue, indigo, violet)' },
        ],
      },
      {
        name: 'My Body',
        questions: [
          { q: 'How many fingers and thumbs are there on one hand altogether?', a: '5' },
          { q: 'Which part of your body do you use to smell?', a: 'Your nose' },
          { q: 'What do your lungs help you do?', a: 'Breathe' },
          { q: 'Which part of your body inside your head helps you think?', a: 'Your brain' },
          { q: 'Which organ pumps blood around your body?', a: 'Your heart' },
        ],
      },
      {
        name: 'Nature & Space',
        questions: [
          { q: 'What sweet food do bees make?', a: 'Honey' },
          { q: 'What do we call water when it is frozen?', a: 'Ice' },
          { q: 'What do plants need from the Sun to grow?', a: 'Sunlight (light)' },
          { q: 'What is the star closest to Earth?', a: 'The Sun' },
          { q: 'What force pulls things down to the ground when you drop them?', a: 'Gravity' },
        ],
      },
    ],
  },
];
