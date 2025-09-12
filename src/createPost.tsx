import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
});

// Add a menu item to create a new custom post.
Devvit.addMenuItem({
  label: 'Create SocialGrid Games Post',
  location: 'subreddit',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
      title: 'SocialGrid Games',
      subredditName: subreddit.name,
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading ...</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'Created post!' });
    ui.navigateTo(post);
  },
});
