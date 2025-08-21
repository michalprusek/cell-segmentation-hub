import { CanvasRenderingContext2D } from 'canvas';

/**
 * Universal number rendering using geometric shapes
 * This approach works across all environments without font dependencies
 */
export const NUMBER_PATHS = {
  drawDigit: (ctx: CanvasRenderingContext2D, digit: number, centerX: number, centerY: number, size: number): void => {
    const width = size * 0.6;
    const height = size;
    const strokeWidth = Math.max(2, size * 0.12);
    
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const left = centerX - width / 2;
    const right = centerX + width / 2;
    const top = centerY - height / 2;
    const bottom = centerY + height / 2;
    const middle = centerY;
    
    switch (digit) {
      case 0:
        ctx.beginPath();
        ctx.moveTo(centerX, top);
        ctx.quadraticCurveTo(right, top, right, middle);
        ctx.quadraticCurveTo(right, bottom, centerX, bottom);
        ctx.quadraticCurveTo(left, bottom, left, middle);
        ctx.quadraticCurveTo(left, top, centerX, top);
        ctx.stroke();
        break;
        
      case 1:
        ctx.beginPath();
        ctx.moveTo(centerX, top);
        ctx.lineTo(centerX, bottom);
        ctx.moveTo(centerX - width * 0.2, top + height * 0.15);
        ctx.lineTo(centerX, top);
        ctx.stroke();
        break;
        
      case 2:
        ctx.beginPath();
        ctx.moveTo(left, top + height * 0.25);
        ctx.quadraticCurveTo(centerX, top, right, top + height * 0.25);
        ctx.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        ctx.lineTo(left, bottom - height * 0.1);
        ctx.lineTo(right, bottom);
        ctx.stroke();
        break;
        
      case 3:
        ctx.beginPath();
        ctx.moveTo(left, top + height * 0.2);
        ctx.quadraticCurveTo(centerX, top, right, top + height * 0.25);
        ctx.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        ctx.moveTo(centerX, middle);
        ctx.quadraticCurveTo(right, middle + height * 0.1, right, bottom - height * 0.25);
        ctx.quadraticCurveTo(centerX, bottom, left, bottom - height * 0.2);
        ctx.stroke();
        break;
        
      case 4:
        ctx.beginPath();
        ctx.moveTo(left + width * 0.2, top);
        ctx.lineTo(left + width * 0.2, middle);
        ctx.lineTo(right, middle);
        ctx.moveTo(right - width * 0.2, top);
        ctx.lineTo(right - width * 0.2, bottom);
        ctx.stroke();
        break;
        
      case 5:
        ctx.beginPath();
        ctx.moveTo(right, top);
        ctx.lineTo(left, top);
        ctx.lineTo(left, middle - height * 0.1);
        ctx.quadraticCurveTo(centerX, middle - height * 0.1, right, middle + height * 0.1);
        ctx.quadraticCurveTo(right, bottom - height * 0.1, centerX, bottom);
        ctx.lineTo(left, bottom - height * 0.2);
        ctx.stroke();
        break;
        
      case 6:
        ctx.beginPath();
        ctx.moveTo(right - width * 0.2, top);
        ctx.quadraticCurveTo(left, top, left, middle);
        ctx.quadraticCurveTo(left, bottom, centerX, bottom);
        ctx.quadraticCurveTo(right, bottom, right, middle + height * 0.1);
        ctx.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        ctx.lineTo(left, middle);
        ctx.stroke();
        break;
        
      case 7:
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
        ctx.lineTo(centerX, bottom);
        ctx.stroke();
        break;
        
      case 8:
        ctx.beginPath();
        // Top circle
        ctx.moveTo(left, top + height * 0.2);
        ctx.quadraticCurveTo(centerX, top, right, top + height * 0.2);
        ctx.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        ctx.quadraticCurveTo(left, middle - height * 0.1, left, top + height * 0.2);
        // Bottom circle
        ctx.moveTo(left, middle + height * 0.1);
        ctx.quadraticCurveTo(left, bottom, centerX, bottom);
        ctx.quadraticCurveTo(right, bottom, right, middle + height * 0.1);
        ctx.quadraticCurveTo(right, middle + height * 0.1, centerX, middle);
        ctx.stroke();
        break;
        
      case 9:
        ctx.beginPath();
        ctx.moveTo(centerX, middle);
        ctx.quadraticCurveTo(right, middle - height * 0.1, right, top + height * 0.2);
        ctx.quadraticCurveTo(right, top, centerX, top);
        ctx.quadraticCurveTo(left, top, left, middle - height * 0.1);
        ctx.quadraticCurveTo(left, middle + height * 0.1, centerX, middle);
        ctx.lineTo(right, middle);
        ctx.quadraticCurveTo(right, bottom, left + width * 0.2, bottom);
        ctx.stroke();
        break;
    }
  },
  
  /**
   * Draw numbers > 9 using dot pattern or multi-digit rendering
   */
  drawLargeNumber: (ctx: CanvasRenderingContext2D, number: number, centerX: number, centerY: number, size: number): void => {
    if (number <= 9) {
      NUMBER_PATHS.drawDigit(ctx, number, centerX, centerY, size);
      return;
    }
    
    if (number <= 99) {
      // Draw two digits side by side
      const digitWidth = size * 0.4;
      const leftDigit = Math.floor(number / 10);
      const rightDigit = number % 10;
      
      NUMBER_PATHS.drawDigit(ctx, leftDigit, centerX - digitWidth * 0.6, centerY, size * 0.7);
      NUMBER_PATHS.drawDigit(ctx, rightDigit, centerX + digitWidth * 0.6, centerY, size * 0.7);
    } else if (number <= 999) {
      // Draw three digits
      const digitWidth = size * 0.3;
      const hundreds = Math.floor(number / 100);
      const tens = Math.floor((number % 100) / 10);
      const ones = number % 10;
      
      NUMBER_PATHS.drawDigit(ctx, hundreds, centerX - digitWidth, centerY, size * 0.5);
      NUMBER_PATHS.drawDigit(ctx, tens, centerX, centerY, size * 0.5);
      NUMBER_PATHS.drawDigit(ctx, ones, centerX + digitWidth, centerY, size * 0.5);
    } else {
      // For very large numbers, use dot pattern
      const dotSize = size * 0.15;
      const dots = Math.min(Math.floor(Math.log10(number)) + 1, 12); // Number of digits, max 12
      const angleStep = (Math.PI * 2) / dots;
      const dotRadius = size * 0.3;
      
      ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
      for (let i = 0; i < dots; i++) {
        const angle = i * angleStep - Math.PI / 2;
        const dotX = centerX + Math.cos(angle) * dotRadius;
        const dotY = centerY + Math.sin(angle) * dotRadius;
        
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Draw abbreviated number in center if space allows
      if (size > 30) {
        ctx.save();
        ctx.font = `${size * 0.3}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        
        let displayText = '';
        if (number >= 1000000) {
          displayText = `${Math.floor(number / 1000000)}M`;
        } else if (number >= 1000) {
          displayText = `${Math.floor(number / 1000)}K`;
        } else {
          displayText = String(number);
        }
        
        ctx.fillText(displayText, centerX, centerY);
        ctx.restore();
      }
    }
  }
};