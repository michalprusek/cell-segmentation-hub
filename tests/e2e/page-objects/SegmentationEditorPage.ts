import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class SegmentationEditorPage extends BasePage {
  readonly canvas: Locator;
  readonly canvasContainer: Locator;
  readonly toolbar: Locator;
  readonly polygonList: Locator;
  readonly propertiesPanel: Locator;

  // Tool buttons
  readonly selectTool: Locator;
  readonly polygonTool: Locator;
  readonly panTool: Locator;
  readonly zoomTool: Locator;
  readonly deleteTool: Locator;

  // Zoom and navigation
  readonly zoomInButton: Locator;
  readonly zoomOutButton: Locator;
  readonly zoomFitButton: Locator;
  readonly zoomResetButton: Locator;

  // Editing actions
  readonly undoButton: Locator;
  readonly redoButton: Locator;
  readonly saveButton: Locator;
  readonly exportButton: Locator;

  // Polygon operations
  readonly mergePolygonsButton: Locator;
  readonly splitPolygonButton: Locator;
  readonly simplifyPolygonButton: Locator;
  readonly deletePolygonButton: Locator;

  // Context menus
  readonly contextMenu: Locator;
  readonly vertexContextMenu: Locator;
  readonly polygonContextMenu: Locator;

  // Status and info
  readonly statusBar: Locator;
  readonly polygonCount: Locator;
  readonly currentTool: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page);

    // Main editor elements - use more specific selectors
    this.canvas = page
      .locator('[data-testid="segmentation-canvas"], canvas')
      .first();
    this.canvasContainer = page
      .locator('[data-testid="canvas-container"], .canvas-container')
      .first();
    this.toolbar = page.locator(
      '[role="toolbar"], .editor-toolbar, .segmentation-toolbar'
    );
    this.polygonList = page.locator(
      '.polygon-list, [data-testid="polygon-list"]'
    );
    this.propertiesPanel = page.locator(
      '.properties-panel, .polygon-properties'
    );

    // Tools
    this.selectTool = page.locator(
      '[data-tool="select"], button[title*="Select"], button[aria-label*="Select"]'
    );
    this.polygonTool = page.locator(
      '[data-tool="polygon"], button[title*="Polygon"], button[aria-label*="Polygon"]'
    );
    this.panTool = page.locator(
      '[data-tool="pan"], button[title*="Pan"], button[aria-label*="Pan"]'
    );
    this.zoomTool = page.locator(
      '[data-tool="zoom"], button[title*="Zoom"], button[aria-label*="Zoom"]'
    );
    this.deleteTool = page.locator(
      '[data-tool="delete"], button[title*="Delete"], button[aria-label*="Delete"]'
    );

    // Zoom controls
    this.zoomInButton = page.getByRole('button', {
      name: /zoom.*in|\+|increase.*zoom/i,
    });
    this.zoomOutButton = page.getByRole('button', {
      name: /zoom.*out|-|decrease.*zoom/i,
    });
    this.zoomFitButton = page.getByRole('button', {
      name: /fit.*screen|zoom.*fit|fit.*view/i,
    });
    this.zoomResetButton = page.getByRole('button', {
      name: /reset.*zoom|100%|actual.*size/i,
    });

    // Actions
    this.undoButton = page.getByRole('button', { name: /undo/i });
    this.redoButton = page.getByRole('button', { name: /redo/i });
    this.saveButton = page.getByRole('button', { name: /save/i });
    this.exportButton = page.getByRole('button', { name: /export/i });

    // Polygon operations
    this.mergePolygonsButton = page.getByRole('button', {
      name: /merge|union|combine/i,
    });
    this.splitPolygonButton = page.getByRole('button', {
      name: /split|divide|cut/i,
    });
    this.simplifyPolygonButton = page.getByRole('button', {
      name: /simplify|smooth|optimize/i,
    });
    this.deletePolygonButton = page.getByRole('button', {
      name: /delete.*polygon/i,
    });

    // Context menus
    this.contextMenu = page.locator('.context-menu, [role="menu"]');
    this.vertexContextMenu = page.locator('.vertex-menu, .point-menu');
    this.polygonContextMenu = page.locator('.polygon-menu, .shape-menu');

    // Status
    this.statusBar = page.locator('.status-bar, .editor-status');
    this.polygonCount = page.locator('.polygon-count, [data-count="polygons"]');
    this.currentTool = page.locator('.current-tool, .active-tool');
    this.loadingIndicator = page.locator('.loading, [data-loading]');
  }

  /**
   * Navigate to segmentation editor
   */
  async navigate(projectId?: string, imageId?: string) {
    let url = '/segmentation';
    if (projectId) {
      url += `/${projectId}`;
      if (imageId) {
        url += `/${imageId}`;
      }
    }
    await this.goto(url);
    await this.waitForLoadState();
  }

  /**
   * Wait for editor to fully load
   */
  async waitForEditorLoad(timeout = 15000) {
    await this.canvas.waitFor({ state: 'visible', timeout });
    await this.loadingIndicator.waitFor({ state: 'hidden', timeout });
  }

  /**
   * Select a tool
   */
  async selectTool(tool: 'select' | 'polygon' | 'pan' | 'zoom' | 'delete') {
    const toolButton = {
      select: this.selectTool,
      polygon: this.polygonTool,
      pan: this.panTool,
      zoom: this.zoomTool,
      delete: this.deleteTool,
    }[tool];

    await this.clickWithWait(toolButton);
  }

  /**
   * Create a polygon by clicking points
   */
  async createPolygon(points: Array<{ x: number; y: number }>) {
    await this.selectTool('polygon');

    for (const point of points) {
      await this.canvas.click({ position: point });
      await this.page.waitForTimeout(100);
    }

    // Close polygon by double-clicking first point or pressing Enter
    await this.canvas.dblclick({ position: points[0] });
  }

  /**
   * Select polygon at position
   */
  async selectPolygon(position: { x: number; y: number }) {
    await this.selectTool('select');
    await this.canvas.click({ position });
  }

  /**
   * Select multiple polygons
   */
  async selectMultiplePolygons(positions: Array<{ x: number; y: number }>) {
    await this.selectTool('select');

    for (let i = 0; i < positions.length; i++) {
      const modifiers = i === 0 ? [] : ['Control'];
      await this.canvas.click({ position: positions[i], modifiers });
    }
  }

  /**
   * Delete selected polygon(s)
   */
  async deleteSelected() {
    await this.page.keyboard.press('Delete');
  }

  /**
   * Move polygon
   */
  async movePolygon(
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) {
    await this.selectPolygon(from);
    await this.canvas.dragTo(this.canvas, {
      sourcePosition: from,
      targetPosition: to,
    });
  }

  /**
   * Enter vertex editing mode
   */
  async enterVertexEditingMode(polygonPosition: { x: number; y: number }) {
    await this.canvas.dblclick({ position: polygonPosition });
  }

  /**
   * Add vertex to polygon edge
   */
  async addVertex(edgePosition: { x: number; y: number }) {
    await this.canvas.click({ position: edgePosition, button: 'right' });
    const addVertexOption = this.contextMenu.getByText(
      /add.*vertex|insert.*point/i
    );
    try {
      await addVertexOption.waitFor({ state: 'visible', timeout: 2000 });
      await addVertexOption.click();
    } catch (error) {
      console.warn('Add vertex context menu option not found:', error);
      throw error; // Re-throw to fail the test
    }
  }

  /**
   * Remove vertex
   */
  async removeVertex(vertexPosition: { x: number; y: number }) {
    await this.canvas.click({ position: vertexPosition, button: 'right' });
    const removeVertexOption = this.contextMenu.getByText(
      /remove.*vertex|delete.*point/i
    );
    try {
      await removeVertexOption.waitFor({ state: 'visible', timeout: 2000 });
      await removeVertexOption.click();
    } catch (error) {
      console.warn('Remove vertex context menu option not found:', error);
      throw error; // Re-throw to fail the test
    }
  }

  /**
   * Zoom in
   */
  async zoomIn(steps = 1) {
    for (let i = 0; i < steps; i++) {
      await this.clickWithWait(this.zoomInButton);
    }
  }

  /**
   * Zoom out
   */
  async zoomOut(steps = 1) {
    for (let i = 0; i < steps; i++) {
      await this.clickWithWait(this.zoomOutButton);
    }
  }

  /**
   * Fit canvas to screen
   */
  async fitToScreen() {
    await this.clickWithWait(this.zoomFitButton);
  }

  /**
   * Pan canvas
   */
  async pan(from: { x: number; y: number }, to: { x: number; y: number }) {
    await this.selectTool('pan');
    await this.canvas.dragTo(this.canvas, {
      sourcePosition: from,
      targetPosition: to,
    });
  }

  /**
   * Undo last action
   */
  async undo() {
    await this.clickWithWait(this.undoButton);
  }

  /**
   * Redo last undone action
   */
  async redo() {
    await this.clickWithWait(this.redoButton);
  }

  /**
   * Save current work
   */
  async save() {
    await this.clickWithWait(this.saveButton);
  }

  /**
   * Export segmentation data
   */
  async export() {
    await this.clickWithWait(this.exportButton);
  }

  /**
   * Merge selected polygons
   */
  async mergePolygons() {
    await this.clickWithWait(this.mergePolygonsButton);
  }

  /**
   * Split polygon
   */
  async splitPolygon(splitLine: {
    from: { x: number; y: number };
    to: { x: number; y: number };
  }) {
    await this.clickWithWait(this.splitPolygonButton);
    await this.canvas.dragTo(this.canvas, {
      sourcePosition: splitLine.from,
      targetPosition: splitLine.to,
    });
  }

  /**
   * Simplify selected polygon
   */
  async simplifyPolygon() {
    await this.clickWithWait(this.simplifyPolygonButton);
  }

  /**
   * Get polygon count
   */
  async getPolygonCount(): Promise<number> {
    const countText = await this.polygonCount.textContent();
    const match = countText?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Check if polygon is selected
   */
  async isPolygonSelected(): Promise<boolean> {
    const selectedIndicators = this.page.locator(
      '.selected, [data-selected="true"], .polygon-selected'
    );
    return (await selectedIndicators.count()) > 0;
  }

  /**
   * Get current tool
   */
  async getCurrentTool(): Promise<string | null> {
    return await this.currentTool.textContent();
  }

  /**
   * Use keyboard shortcuts
   */
  async useKeyboardShortcut(shortcut: string) {
    await this.page.keyboard.press(shortcut);
  }

  /**
   * Select all polygons
   */
  async selectAll() {
    await this.useKeyboardShortcut('Control+a');
  }

  /**
   * Copy selected polygons
   */
  async copy() {
    await this.useKeyboardShortcut('Control+c');
  }

  /**
   * Paste polygons
   */
  async paste() {
    await this.useKeyboardShortcut('Control+v');
  }

  /**
   * Get vertices of selected polygon
   */
  async getVertices(): Promise<Array<{ x: number; y: number }>> {
    const vertices = this.page.locator('.vertex, .handle, [data-vertex]');
    const count = await vertices.count();
    const positions: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < count; i++) {
      const vertex = vertices.nth(i);
      const box = await vertex.boundingBox();
      if (box) {
        positions.push({
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        });
      }
    }

    return positions;
  }

  /**
   * Check if editor is in loading state
   */
  async isLoading(): Promise<boolean> {
    return await this.loadingIndicator.isVisible({ timeout: 1000 });
  }

  /**
   * Wait for operation to complete
   */
  async waitForOperation(timeout = 10000) {
    await this.loadingIndicator.waitFor({ state: 'hidden', timeout });
  }

  /**
   * Get polygon list items
   */
  async getPolygonListItems(): Promise<number> {
    const items = this.polygonList.locator('.polygon-item, [data-polygon]');
    return await items.count();
  }

  /**
   * Select polygon from list
   */
  async selectPolygonFromList(index: number) {
    const items = this.polygonList.locator('.polygon-item, [data-polygon]');
    await items.nth(index).click();
  }

  /**
   * Check if undo is available
   */
  async isUndoAvailable(): Promise<boolean> {
    return await this.undoButton.isEnabled();
  }

  /**
   * Check if redo is available
   */
  async isRedoAvailable(): Promise<boolean> {
    return await this.redoButton.isEnabled();
  }

  /**
   * Perform complex polygon operation
   */
  async performComplexOperation(operation: string, ...args: any[]) {
    switch (operation) {
      case 'createComplexPolygon':
        return await this.createComplexPolygon(args[0]);
      case 'bulkSelect':
        return await this.bulkSelect(args[0]);
      case 'precisionEdit':
        return await this.precisionEdit(args[0]);
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * Create complex polygon with many vertices
   */
  private async createComplexPolygon(config: {
    center: { x: number; y: number };
    radius: number;
    vertices: number;
  }) {
    const { center, radius, vertices } = config;
    const points: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < vertices; i++) {
      const angle = (i / vertices) * 2 * Math.PI;
      const x = center.x + Math.cos(angle) * (radius + Math.random() * 20);
      const y = center.y + Math.sin(angle) * (radius + Math.random() * 20);
      points.push({ x: Math.round(x), y: Math.round(y) });
    }

    await this.createPolygon(points);
  }

  /**
   * Select multiple polygons using box selection
   */
  private async bulkSelect(area: {
    from: { x: number; y: number };
    to: { x: number; y: number };
  }) {
    await this.selectTool('select');
    await this.canvas.dragTo(this.canvas, {
      sourcePosition: area.from,
      targetPosition: area.to,
      modifiers: ['Shift'],
    });
  }

  /**
   * Perform precision editing with fine movements
   */
  private async precisionEdit(config: {
    polygon: { x: number; y: number };
    adjustments: Array<{ x: number; y: number }>;
  }) {
    await this.enterVertexEditingMode(config.polygon);

    const vertices = await this.getVertices();
    for (
      let i = 0;
      i < Math.min(vertices.length, config.adjustments.length);
      i++
    ) {
      const vertex = vertices[i];
      const adjustment = config.adjustments[i];

      await this.canvas.dragTo(this.canvas, {
        sourcePosition: vertex,
        targetPosition: {
          x: vertex.x + adjustment.x,
          y: vertex.y + adjustment.y,
        },
      });
    }
  }
}
