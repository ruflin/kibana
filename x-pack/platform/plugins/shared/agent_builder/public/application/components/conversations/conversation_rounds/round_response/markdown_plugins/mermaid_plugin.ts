/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type { Parent } from 'mdast';
import type { Node } from 'unist';

type CodeNode = Node & {
  lang?: string;
};

export const mermaidLanguagePlugin = () => {
  const visitor = (node: Node) => {
    if ('children' in node) {
      const nodeAsParent = node as Parent;
      nodeAsParent.children.forEach((child) => {
        visitor(child);
      });
    }

    if (node.type === 'code' && (node as CodeNode).lang === 'mermaid') {
      node.type = 'mermaid';
    }
  };

  return (tree: Node) => {
    visitor(tree);
  };
};
