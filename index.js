import dotenv from "dotenv";
import { ethers } from "ethers";
import express from "express";
import { createClient } from "redis";

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

// 0x35E38E69Ae9b11b675f2062b3D4E9FFB5ef756AC -- hardcoded
class PaymentMonitor {
  constructor() {
    this.setupProvider();
    this.chatConfigs = new Map();
  }

  async initialize() {
    const chatIds = await client.get("all-chat-ids");
    const chatIdsArray = JSON.parse(chatIds);
    console.log({ chatIdsArray });

    for (const chatId of chatIdsArray) {
      const value = await client.get(chatId);
      const config = JSON.parse(value);
      console.log({ config });
      const configData = {
        walletAddress: config.walletAddress,
        memberCount: config.requestData.numberOfGuests,
        paymentsReceived: 0,
        amountPerWallet: config.requestData.amountPerGuest,
      };
      this.chatConfigs.set(chatId, configData);
    }
  }

  setupProvider() {
    const providerUrl = "wss://base-sepolia.publicnode.com"; // Base Sepolia WebSocket URL
    this.provider = new ethers.WebSocketProvider(providerUrl, undefined, {
      reconnect: {
        auto: true,
        retries: 5,
        delay: 5000,
      },
    });

    this.usdcContract = new ethers.Contract(
      "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      USDC_ABI,
      this.provider
    );
  }

  start() {
    const setupListener = () => {
      this.usdcContract.on("Transfer", async (from, to, value, event) => {
        console.log({ from, to, value });
        for (const [chatId, config] of this.chatConfigs.entries()) {
          console.log({ chatId, config });
          if (to.toLowerCase() === config.walletAddress.toLowerCase()) {
            console.log("wallet match");

            if (value === 100000n) {
              config.paymentsReceived++;
              console.log({ config });

              if (config.paymentsReceived === config.memberCount) {
                await this.triggerWebhook(chatId);
                config.paymentsReceived = 0;
              }
            }
          }
        }
      });
    };

    // Initial setup
    setupListener();

    // Reconnect every 2 mins to prevent filter timeout
    setInterval(() => {
      try {
        this.usdcContract.removeAllListeners("Transfer");
        this.setupProvider();
        setupListener();
        console.log("Reconnected event listener");
      } catch (error) {
        console.error("Error reconnecting:", error);
      }
    }, 60 * 20 * 1000); // 2 mins in milliseconds
  }

  async triggerWebhook(chatId) {
    try {
      const command = "Funding is complete, looking for the best hotels...";
      const params = undefined;
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
      const data = await response.json();
      console.log({ data });
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

const client = createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT ?? 13744),
  },
});

client.on("error", (err) => console.log("Redis Client Error", err));

const monitor = new PaymentMonitor();

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

// const triggerCommand = async (chatId, command, params) => {
//   const url = "http://localhost:3000/api/telegram/funded";

//   const response = await fetch(url, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({
//       chatId,
//       command,
//       params,
//     }),
//   });

//   console.log({ response });

//   return response.json();
// };

// const getTelegramInfo = async () => {
//   const url = "http://localhost:3000/api/telegram/info";

//   const response = await fetch(url, {
//     method: "GET",
//     headers: {
//       "Content-Type": "application/json",
//     },
//   });

//   console.log({ response });

//   return response.json();
// };

// const getTelegramChats = async () => {
//   const url = "http://localhost:3000/api/telegram/chats";

//   const response = await fetch(url, {
//     method: "GET",
//     headers: {
//       "Content-Type": "application/json",
//     },
//   });

//   return response.json();
// };

// Start everything

async function start() {
  console.log(`Starting listener 👂🏻`);
  await client.connect();
  await monitor.initialize();
  monitor.start();
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`Server running on port ${port}`));
}

start().catch(console.error);
