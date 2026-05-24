const express = require('express');
const favoritesLib = require('../lib/favorites.js');

module.exports = (ctx) => {
  const r = express.Router();

  r.get('/api/favorites', (req, res) => {
    res.json([...favoritesLib.loadFavorites(ctx.paths.FAVORITES_FILE)]);
  });

  r.post('/api/favorites/:id', (req, res) => {
    const favs = favoritesLib.loadFavorites(ctx.paths.FAVORITES_FILE);
    favs.add(req.params.id);
    favoritesLib.saveFavorites(ctx.paths.FAVORITES_FILE, favs);
    ctx.broadcast('favorites-changed', [...favs]);
    res.json({ ok: true });
  });

  r.delete('/api/favorites/:id', (req, res) => {
    const favs = favoritesLib.loadFavorites(ctx.paths.FAVORITES_FILE);
    favs.delete(req.params.id);
    favoritesLib.saveFavorites(ctx.paths.FAVORITES_FILE, favs);
    ctx.broadcast('favorites-changed', [...favs]);
    res.json({ ok: true });
  });

  return r;
};
