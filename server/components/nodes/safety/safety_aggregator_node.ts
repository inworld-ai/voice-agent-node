import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

/**
 * Safety aggregator node that combines classification and keyword matching results
 * to make final safety decisions.
 *
 * This custom node processes input from text classification and keyword matching
 * to determine if content is safe. Content is considered safe only when both
 * the classifier detects no unsafe categories and the keyword matcher finds
 * no prohibited terms.
 *
 * @example
 * ```typescript
 * // Create safety aggregator for use in safety checking pipeline
 * const safetyAggregator = new SafetyAggregatorCustomNode();
 *
 * // Use in safety subgraph
 * const safetySubgraph = new SubgraphBuilder('safety_check')
 *   .addNode(inputNode)
 *   .addNode(textClassifierNode)
 *   .addNode(keywordMatcherNode)
 *   .addNode(safetyAggregator)
 *   .addEdge(inputNode, textClassifierNode)
 *   .addEdge(inputNode, keywordMatcherNode)
 *   .addEdge(inputNode, safetyAggregator)
 *   .addEdge(textClassifierNode, safetyAggregator)
 *   .addEdge(keywordMatcherNode, safetyAggregator)
 *   .setStartNode(inputNode)
 *   .setEndNode(safetyAggregator);
 *
 * // The aggregator will output SafetyResult with isSafe boolean
 * ```
 */
export class SafetyAggregatorCustomNode extends CustomNode {
  process(_context: ProcessContext, ...inputs: any[]): any {
    // Extract the three inputs: text, classification, keywords
    const text =
      typeof inputs[0] === 'string' ? inputs[0] : inputs[0]?.text || '';
    const classification = inputs.find((i) => i?.classes !== undefined) || {
      classes: [],
    };
    const keywords = inputs.find((i) => i?.keywords !== undefined) || {
      keywords: [],
    };

    // Content is safe only when BOTH conditions are met:
    // 1. No unsafe classes detected by classifier
    // 2. No unsafe keywords matched
    const hasUnsafeClasses =
      classification.classes && classification.classes.length > 0;
    const hasKeywordMatches = keywords.keywords && keywords.keywords.length > 0;

    const isSafe = !hasUnsafeClasses && !hasKeywordMatches;
    const unsafeClasses = classification.classes || [];
    const keywordMatches = keywords.keywords || [];

    // Basic safety logging
    console.log(`[Safety] Text analyzed: "${text}"`);
    console.log(`[Safety] Result: ${isSafe ? 'SAFE' : 'UNSAFE'}`);
    if (!isSafe) {
      if (hasUnsafeClasses) {
        const classLabels = unsafeClasses.map((c: any) => c.label || c).join(', ');
        console.log(`[Safety] Classes detected: ${classLabels}`);
      }
      if (hasKeywordMatches) {
        const matchedKeywords = keywordMatches.map((m: any) => m.keyword || m).join(', ');
        console.log(`[Safety] Keywords matched: ${matchedKeywords}`);
      }
    }

    return new GraphTypes.SafetyResult({
      isSafe,
      text,
      classes: unsafeClasses,
      keywordMatches: keywordMatches,
    });
  }
}
