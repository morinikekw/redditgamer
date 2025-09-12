import { GameAPI } from './api.js';
import { Devvit } from '@devvit/public-api';
import type { GameType } from './types';

export const GamePostForm = Devvit.createForm(
  {
    title: 'Create Game Post',
    fields: [
      {
        name: 'title',
        label: 'Post Title',
        type: 'string',
        required: true,
        defaultValue: 'Multiplayer Game'
      },
      {
        name: 'gameType',
        label: 'Select Game',
        type: 'select',
        options: [
          { label: 'Tic Tac Toe', value: 'tictactoe' },
          { label: 'Gomoku', value: 'gomoku' },
          { label: 'Dots & Boxes', value: 'dots' },
          { label: 'Connect Four', value: 'connect4' },
        ],
        required: true,
        defaultValue: 'tictactoe'
      },
      {
        name: 'maxPlayers',
        label: 'Maximum Players',
        type: 'number',
        required: true,
        min: 2,
        max: 4,
        defaultValue: 2
      },
    ],
    acceptLabel: 'Create Game',
  },
  async (event, context) => {
    try {
      const { values } = event;
      const { ui, reddit, redis } = context;

      if (!values) throw new Error('Form values are missing');

      const gameType = values.gameType as GameType;
      const maxPlayers = Number(values.maxPlayers);
      const title = values.title || 'Multiplayer Game';

      const post = await reddit.submitPost({
        title: title,
        subredditName: (await reddit.getCurrentSubreddit()).name,
        preview: Devvit.createElement("vstack", {
          padding: "medium",
          cornerRadius: "medium",
          backgroundColor: "#FF4500",
          children: [
            Devvit.createElement("text", {
              style: "heading",
              color: "white",
              children: title
            }),
            Devvit.createElement("text", {
              color: "white",
              children: `Click to play ${gameType}!`
            })
          ]
        }),
      });

      await GameAPI.initializeGame(redis, post.id, gameType, maxPlayers);

      ui.showToast(`Game post created successfully!`);
      ui.navigateTo(post);
    } catch (error) {
      context.ui.showToast(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // console.error('Game creation error:', error);
    }
  }
);
