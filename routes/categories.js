const express = require('express');

module.exports = (ctx) => {
  const r = express.Router();

  r.get('/api/categories', (req, res) => res.json(ctx.store.categories));

  // Create or update a category
  r.post('/api/categories', (req, res) => {
    const { id, name, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: ctx.t('error.nameRequired') });
    if (id) {
      // Update
      const cat = ctx.store.categories.categories.find(c => c.id === id);
      if (!cat) return res.status(404).json({ error: ctx.t('error.categoryNotFound') });
      cat.name  = name.trim();
      cat.color = color || cat.color;
    } else {
      // Create
      const newCat = { id: `cat_${Date.now()}`, name: name.trim(), color: color || '#6366f1' };
      ctx.store.categories.categories.push(newCat);
    }
    ctx.saveCategories();
    res.json(ctx.store.categories);
  });

  // Delete a category
  r.delete('/api/categories/:id', (req, res) => {
    const { id } = req.params;
    ctx.store.categories.categories = ctx.store.categories.categories.filter(c => c.id !== id);
    // Clean up assignments
    for (const pid of Object.keys(ctx.store.categories.assignments)) {
      ctx.store.categories.assignments[pid] = ctx.store.categories.assignments[pid].filter(cid => cid !== id);
      if (!ctx.store.categories.assignments[pid].length) delete ctx.store.categories.assignments[pid];
    }
    ctx.saveCategories();
    res.json(ctx.store.categories);
  });

  // Assign / unassign a category to a project
  r.post('/api/categories/assign', (req, res) => {
    const { projectId, categoryId, action } = req.body; // action: 'add' | 'remove'
    if (!projectId || !categoryId) return res.status(400).json({ error: ctx.t('error.projectIdAndCategoryIdRequired') });
    const current = ctx.store.categories.assignments[projectId] || [];
    if (action === 'add' && !current.includes(categoryId)) {
      ctx.store.categories.assignments[projectId] = [...current, categoryId];
    } else if (action === 'remove') {
      ctx.store.categories.assignments[projectId] = current.filter(id => id !== categoryId);
      if (!ctx.store.categories.assignments[projectId].length) delete ctx.store.categories.assignments[projectId];
    }
    ctx.saveCategories();
    res.json(ctx.store.categories.assignments[projectId] || []);
  });

  return r;
};
