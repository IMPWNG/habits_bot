require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const userStates = {};
let lastWelcomeDate = null;

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const currentDate = new Date().toISOString().split("T")[0];

  if (lastWelcomeDate !== currentDate) {
    bot.sendMessage(chatId, "Welcome! Tell me about your day.");
    lastWelcomeDate = currentDate;
  }
});

bot.on("message", async (msg) => {
  if (msg.text === "/start") return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userStates[userId] === "adding_activity") {
    await addActivity(msg);
    askForDuration(chatId, userId);
  } else {
    await addActivity(msg);
    askForDuration(chatId, userId);
  }
});

async function addActivity(msg) {
  const messageDate = new Date(msg.date * 1000).toISOString();
  const { error } = await supabase.from("activities").insert([
    {
      user_id: msg.from.id,
      first_name: msg.from.first_name,
      message_date: messageDate,
      message_text: msg.text,
    },
  ]);

  if (error) {
    console.error("Error inserting data into Supabase:", error);
    bot.sendMessage(
      msg.chat.id,
      "Sorry, there was an error processing your message."
    );
    return false;
  }
  return true;
}

function askForDuration(chatId, userId) {
  userStates[userId] = "awaiting_duration";
  bot.sendMessage(
    chatId,
    "Thank you, your message has been recorded. How much time?",
    {
      reply_markup: JSON.stringify({
        inline_keyboard: new Array(8).fill(0).map((_, i) => [
          {
            text: `${(i + 1) * 15} minutes`,
            callback_data: `duration_${(i + 1) * 15}`,
          },
        ]),
      }),
    }
  );
}

bot.on("callback_query", async (callbackQuery) => {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message.chat.id;
  if (callbackQuery.data.startsWith("duration_")) {
    const durationInMinutes = parseInt(callbackQuery.data.split("_")[1]);
    await updateDuration(userId, durationInMinutes, chatId);
  } else {
    switch (callbackQuery.data) {
      case "add_another":
        userStates[userId] = "adding_activity";
        bot.sendMessage(chatId, "What's the next activity you did?");
        break;
      case "no_more":
        // Instead of concluding, ask if the user is done for the day
        userStates[userId] = "confirming_end_of_day";
        bot.sendMessage(chatId, "Are you done for today?", {
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [{ text: "Yes, I'm done", callback_data: "end_of_day" }],
              [
                {
                  text: "No, I have more to add",
                  callback_data: "add_another",
                },
              ],
            ],
          }),
        });
        break;
      case "end_of_day":
        delete userStates[userId];
        bot.sendMessage(
          chatId,
          "✨ You're all done for today! ✨\nFeel free to clear the chat or start a new conversation whenever you're ready for more. Have a great day!"
        );
        break;
    }
  }
});

async function updateDuration(userId, durationInMinutes, chatId) {
  const { error } = await supabase
    .from("activities")
    .update({ duration: durationInMinutes })
    .match({ user_id: userId })
    .order("id", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error updating duration:", error);
    bot.sendMessage(
      chatId,
      "Sorry, there was an error recording the duration."
    );
    return;
  }

  bot.sendMessage(
    chatId,
    `Duration of ${durationInMinutes} minutes has been recorded. Would you like to add another activity?`,
    {
      reply_markup: JSON.stringify({
        inline_keyboard: [
          [{ text: "Yes", callback_data: "add_another" }],
          [{ text: "No", callback_data: "no_more" }],
        ],
      }),
    }
  );
}
