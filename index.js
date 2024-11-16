import dotenv from "dotenv";
// import ethers from "ethers";
import express from "express";
import { MongoClient } from "mongodb";
import { create } from "@web3-storage/w3up-client";

dotenv.config();
// USDC ABI (same as before)
const USDC_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: "from",
        type: "address",
      },
      {
        indexed: true,
        name: "to",
        type: "address",
      },
      {
        indexed: false,
        name: "value",
        type: "uint256",
      },
    ],
    name: "Transfer",
    type: "event",
  },
];

export const getRPCURL = (chainId) => {
  switch (chainId) {
    case "optimism":
      return "https://optimism.blockpi.network/v1/rpc/eaacc51719a9ca9443bba93db5a3b56bafbdae3a";
    case "arbitrumone":
      return "https://arbitrum.blockpi.network/v1/rpc/public";
    case "berachaintestnet":
      return "https://silent-crimson-glade.bera-artio.quiknode.pro/d441b1ca9b02993b53004ee926c7ac55672bde2a/";
    case "polygontestnet":
      return "https://rpc.polygontestnet.com";
    case "polygon":
      return "https://polygon.blockpi.network/v1/rpc/public";
    case "base":
      return "https://base.blockpi.network/v1/rpc/public";
    case "base-sepolia":
      return "https://base-sepolia-rpc.publicnode.com";
    case "ethereum":
      return "https://ethereum.blockpi.network/v1/rpc/public";
    case "sepolia":
      return "https://ethereum-sepolia.blockpi.network/v1/rpc/public";
    case "mantle":
      return "https://mantle-mainnet.public.blastapi.io";
    case "mode":
      return "https://mainnet.mode.network/";
    case "arthera":
      return "https://rpc.arthera.net";
    case "taikotestnet":
      return "https://taiko-katla.blockpi.network/v1/rpc/public"; //double check
    default:
      return "";
  }
};

class PaymentMonitor {
  constructor() {
    this.provider = new ethers.providers.JsonRpcProvider(
      getRPCURL("base-sepolia")
    );
    this.usdcContract = new ethers.Contract(
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", //base contract
      USDC_ABI,
      this.provider
    );
    this.chatConfigs = new Map(); // chatId -> {walletAddress, memberCount, amountPerWallet, paymentsReceived}
    this.chatConfigs.set("-4555870136", {
      walletAddress: "0xD7D7474BD9099FA7B44C75E95FF635092D4F0d9c", //ellie hackathon wallet
      memberCount: 1,
      amountPerWallet: 1,
      paymentsReceived: 0,
    });

    // this.mongoClient = new MongoClient(process.env.MONGODB_URI);
  }

  //   async connect() {
  //     await this.mongoClient.connect();
  //     const db = this.mongoClient.db("telegram-payments");
  //     this.chatsCollection = db.collection("chat-configs");

  //     // Load existing configurations
  //     const configs = await this.chatsCollection.find({}).toArray();
  //     configs.forEach((config) => {
  //       this.chatConfigs.set(config.chatId, {
  //         walletAddress: config.walletAddress,
  //         memberCount: config.memberCount,
  //         amountPerWallet: config.amountPerWallet,
  //         paymentsReceived: 0,
  //       });
  //     });
  //   }

  //   async addOrUpdateChat(chatId, walletAddress, memberCount, amountPerWallet) {
  //     const config = {
  //       chatId,
  //       walletAddress,
  //       memberCount,
  //       amountPerWallet,
  //       updatedAt: new Date(),
  //     };

  //     await this.chatsCollection.updateOne(
  //       { chatId },
  //       { $set: config },
  //       { upsert: true }
  //     );

  //     this.chatConfigs.set(chatId, {
  //       ...config,
  //       paymentsReceived: 0,
  //     });
  //   }

  //   async removeChat(chatId) {
  //     await this.chatsCollection.deleteOne({ chatId });
  //     this.chatConfigs.delete(chatId);
  //   }

  start() {
    this.usdcContract.on("Transfer", async (from, to, value, event) => {
      for (const [chatId, config] of this.chatConfigs.entries()) {
        if (to.toLowerCase() === config.walletAddress.toLowerCase()) {
          const expectedAmount = ethers.utils.parseUnits(
            config.amountPerWallet.toString(),
            6
          );

          if (value.eq(expectedAmount)) {
            config.paymentsReceived++;

            if (config.paymentsReceived === config.memberCount) {
              await this.triggerWebhook(chatId);
              config.paymentsReceived = 0;
            }
          }
        }
      }
    });
  }

  async triggerWebhook(chatId) {
    const config = this.chatConfigs.get(chatId);

    try {
      const response = await fetch(process.env.TELEGRAM_BOT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          event: "payments_complete",
          wallet_address: config.walletAddress,
          member_count: config.memberCount,
          amount_per_wallet: config.amountPerWallet,
        }),
      });

      if (!response.ok)
        throw new Error(`Webhook failed: ${response.statusText}`);
    } catch (error) {
      console.error("Webhook error:", error);
    }
  }
}

// Express server setup
const app = express();
app.use(express.json());

// const monitor = new PaymentMonitor();

// API endpoints for Telegram bot
app.post("/chat/config", async (req, res) => {
  const { chatId, walletAddress, memberCount, amountPerWallet } = req.body;
  await monitor.addOrUpdateChat(
    chatId,
    walletAddress,
    memberCount,
    amountPerWallet
  );
  res.json({ success: true });
});

app.delete("/chat/:chatId", async (req, res) => {
  await monitor.removeChat(req.params.chatId);
  res.json({ success: true });
});

const triggerCommand = async (chatId, command, params) => {
  const url = "http://localhost:3000/api/telegram/funded";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chatId,
      command,
      params,
    }),
  });

  console.log({ response });

  return response.json();
};

const getTelegramInfo = async () => {
  const url = "http://localhost:3000/api/telegram/info";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  console.log({ response });

  return response.json();
};

const getTelegramChats = async () => {
  const url = "http://localhost:3000/api/telegram/chats";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  return response.json();
};

// Start everything
async function start() {
  //   await monitor.connect();
  //   monitor.start();
  //   const client = await create();
  //   const account = await client.login("ellie.farrisi@gmail.com");
  //   console.log({ account });

  //trigger the backend for telegram bot message
  const telegramBotMessage = "funding is complete.";

  await triggerCommand("-4555870136", telegramBotMessage);
  //   await getTelegramInfo();
  const chats = await getTelegramChats();
  console.log({ chats });

  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`Server running on port ${port}`));
}

start().catch(console.error);
