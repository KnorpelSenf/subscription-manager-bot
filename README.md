# Subscription Manager Bot

Telegram bot to restrict group members to paying customers.

## The Why

Sometimes it is nice to have a Telegram channel that you can use to spread the word about some stuff that matters.
However, valuable as your insights are, you don't want to give them out for free.
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

1. Alice's Browser will open the Telegram client with the payload injected.
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
4. In addition, it will be banned from the group so that all previously sent invitation links are automatically invalidated for it.

### Cancelling Subscriptions (No User Interaction)

Once Alice decides to cancel her subscription for your service, your system has to fetch another URL.
This will

1. disable her status as paying customer in the spreadsheet (set the corresponding value to FALSE) and
2. kick and
3. ban her from the group chat, again make her unable to join again.

## The How

### Development

Run `npm install` and you're good to go.
All the code is contained in `index.ts`.

Building is done by `npm run build` and linting is done by `npm run lint`.
Using VSCode will help you enforce linting if you install all of the extensions you find when searching for `@recommended`.

Note that `npx functions-framework` can help you run any cloud function locally.
It is listed under the dev dependencies.

### Deployment

This project is deployed using three Google Cloud Functions.
One is responsible for the the payload generation and redirect, one is responsible for the Telegram bot, and one is responsible for when a subscriptions ends.

The easiest way to deploy this project is to

1. create a Google Cloud Source Repository that mirrors a fork of this repo,
2. create a build trigger with the configuration below in Google Cloud Build, and
3. manually run the trigger.

(You can also look at the Cloud Build config and run the commands there manually if you want.)

This will execute the build steps defined in `cloudbuild.yaml`.
That way, all the Cloud Functions are created and configured correctly and automatically.

Here is how you have to configure the trigger:

1. Select your mirror repo as the base for this trigger
2. Name, description, event, and source branch are irrelevant (pick anything you like)
3. Choose `Cloud Build configuration file (yaml or json)`
4. Specify `cloudbuild.yaml` as file location

These substitution variables have to be set:

| Variable              | What to put in value                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_BOT_TOKEN`          | The token you obtained from [@BotFather](https://t.me/BotFather) when you created your Telegram bot                                                            |
| `_FUNCTION_NAME`      | A long ID to use as base URL for the bot webhook and the subscription cancellation endpoint (it makes sense to use the bot token with `-` instead of `:` here) |
| `_INSIDER_CHAT_ID`    | The chat ID of your secret Telegram chat (make sure the bot is an admin member of it so it can kick and ban people)                                            |
| `_SHEET_ID`           | The ID of the Google Sheet (can be found in the URL, just google how to obtain it)                                                                             |
| `_SHEET_CLIENT_EMAIL` | A service account email from your IAM that is used to modify your Google Sheet (make sure this account has edit permissions to the spreadsheet)                |
| `_SHEET_PRIVATE_KEY`  | The private key to the service account so that the system can authenticate itself in order to access the Google Sheet                                          |

The Google Sheet is expected to have (at least) three columns.
They can have any title in the first row.
The other rows are expected to have the email address in the first column, a boolean indicating a valid subscription in the second column (`TRUE` or `FALSE`), and an integer for the Telegram user ID in the third column.

The first column will never be modified by the system.
Make sure it contains no duplicates.

The second column's values will only be set to `FALSE` when a subscription is cancelled.
It will never be set to `TRUE` by the system.

The third column is used to store Telegram user IDs.
It is expected never to be modified by a third author.

In summary, it could look like this:

| My nice email collection | Whether we like them | Here you have some Telegram numbers |
| ------------------------ | -------------------- | ----------------------------------- |
| alice@gmail.com          | `TRUE`               | 12345                               |
| bob@gmail.com            | `FALSE`              | 67890                               |
| eve@gmail.com            | `TRUE`               |                                     |

Remember to set the cloud function URL as the webhook for the Telegram bot!
This can be done by calling [this method](https://core.telegram.org/bots/api#setwebhook).

If you want to specify `allowed_updates` to reduce the number of invocations of your Cloud Function, make sure to include at least the update type `message`.
All other updates are ignored by the bot.

## The Rest

This is a small side-project I did for fun and for free.
Go ahead and play around with it, but please read and understand the license.

If you have a security concern (is it possible to break the system?), please do let me know!

### Contributions

Do you want to make the strings adjustable?
Is there something else you want to improve?
Do not hesitate to submit Pull Requests of any kind, I'm happy to review them!

### How Much Does It Cost to Host This

[Probably nothing.](https://cloud.google.com/free)
Unless you have more than 2,000,000 invocations per month, then it could be a few bucks.
Per year.
But at that point you should just make your subscription more expensive.
