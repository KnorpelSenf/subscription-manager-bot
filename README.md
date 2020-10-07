# Subscription Manager Bot

Telegram Bot to restrict group members to paying customers.

## The Why

Sometimes it is nice to have a Telegram channel that you can use to spread the word about some stuff that matters.
However, as valuable as your insights are, you don't want to give them out for free.
Instead, you only want paying customers to be allowed in your channel.

This project integrates a Telegram bot with your service and links Telegram users to email addresses that are listed in a Google Sheets document.
As a result, you can make sure that only those customers with an email address in your spreadsheet are able to follow you on Telegram.
In other words, only those customers with an active subscription can read your Telegram news.

**Note:** Telegram does not allow third parties to manage channel subscribers.
You therefore have to create a read-only group chat.
It will behave the same way as a channel, but can only hold up to 200,000 members (and not infinitely many).

## The Flow

What does it look like for your users to participate in this authentication flow?
It is actually quite convenient for them.
They will interact with this system at three different points, but they notice that only once and all it takes is literally the push of a button.
Well, two.

### Registration (First Interaction)

Alice subscribed to your system.
Your system then inserts a row into a defined Google Sheet with her email address and a value TRUE indicating that she is a paying customer.
Your system furthermore displays a link to Alice to join the news group, for example by sending her an email.
(That link has to contain the email address of Alice in the query parameters.)

1. The first interaction of Alice is therefore clicking this link.
2. It brings her to a website that extracts her email address from the query parameters and generates a special payload from it.
3. It will then redirect her to `telegram.me` to the chat with the bot, injecting the payload.

From the perspective of Alice, your system brings her directly to the Telegram bot.

### Linking Telegram Account to Email Address (Second Interaction)

1. Alice' Browser will open the Telegram client with the payload injected.
2. Alice has to press the displayed START button.
3. Telegram will contact this bot and send the payload along the message.
4. The system can therefore identify Alice and insert her Telegram user ID to match the email address in the spreadsheet.
5. It will at this point also verify that Alice is a paying customer.
6. Alice receives a response from the bot with an invitation button to join the group.
7. Alice clicks the button to join the group and becomes a member of it.

### Verifying Joined Accounts (Third Interaction)

1. Once Alice joins the group, this bot will be notified of the new member.
2. The bot checks back if the joined user is a paying customer by looking up the ID in the spreadsheet.
3. If this user is not allowed in the group, the account will be kicked immediately.
4. In addition, she will be banned from the group so that all previously sent invitation links are automatically invalidated for her.

### Cancelling Subscriptions (No User Interaction)

Once Alice decides to cancel her subscription for your service, your system has to fetch another URL.
This will

1. disable her status as paying customer in the spreadsheet (set the corresponding value to FALSE) and
2. kick and
3. ban her from the group chat.
