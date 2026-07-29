import defaultApp from './app.js';

const PORT = process.env.PORT || 3000;

const server = defaultApp.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export { server };
