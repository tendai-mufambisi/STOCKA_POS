# Thermal Printing Integration Guide

## Overview
This guide shows how to use the robust thermal printing system with `@plick/electron-pos-printer`.

## Quick Start

### 1. In Your React Component

```jsx
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'

export const MyComponent = () => {
  const { printReceipt, printTestReceipt, isPrinting, printError, printSuccess } = useReceiptPrinter()

  const handlePrintReceipt = async () => {
    const receiptData = {
      receipt_number: '20260419-0001',
      date: new Date().toLocaleString(),
      cashier: 'John Doe',
      items: [
        { product_name: 'Bread', quantity: 1, selling_price: 2.50 },
        { product_name: 'Milk 1L', quantity: 2, selling_price: 1.50 }
      ],
      subtotal: 5.50,
      tax: 0.00,
      total: 5.50,
      payment_method: 'Cash',
      cash_tendered: 10.00,
      change_given: 4.50
    }

    const shopInfo = {
      name: 'STOCKA SHOP',
      address: '123 Main Street, Harare',
      phone: '+263 12 345 6789'
    }

    const success = await printReceipt(receiptData, shopInfo, {
      isDuplicate: false,
      withBarcode: true,
      printerName: '' // Auto-detect default printer
    })

    if (success) {
      console.log('Receipt printed successfully!')
    }
  }

  const handleTestPrint = async () => {
    await printTestReceipt() // Prints a test receipt
  }

  return (
    <div>
      <button onClick={handlePrintReceipt} disabled={isPrinting}>
        {isPrinting ? 'Printing...' : 'Print Receipt'}
      </button>

      <button onClick={handleTestPrint} disabled={isPrinting}>
        Test Print
      </button>

      {printError && <div style={{ color: 'red' }}>Error: {printError}</div>}
      {printSuccess && <div style={{ color: 'green' }}>Receipt printed successfully!</div>}
    </div>
  )
}
```

## API Reference

### useReceiptPrinter Hook

**Returns:**
```typescript
{
  printReceipt: (receiptData, shopInfo?, options?) => Promise<boolean>,
  printTestReceipt: (printerName?) => Promise<boolean>,
  isPrinting: boolean,
  printError: string | null,
  printSuccess: boolean
}
```

### printReceipt(receiptData, shopInfo, options)

**Parameters:**

- `receiptData` (Object, required)
  - `receipt_number` (string): Unique receipt identifier
  - `date` (string): Receipt date/time
  - `cashier` (string): Cashier name
  - `items` (Array): Line items
    - `product_name` (string): Item name
    - `quantity` (number): Item quantity
    - `selling_price` (number): Unit price
    - `subtotal` (number): Total for this item
  - `subtotal` (number): Before tax
  - `tax` (number): Tax amount
  - `total` (number): Final total
  - `payment_method` (string): How paid (e.g., "Cash", "Card")
  - `cash_tendered` (number, optional): Cash given
  - `change_given` (number, optional): Change received

- `shopInfo` (Object, optional)
  - `name` (string): Shop name
  - `address` (string): Shop address
  - `phone` (string): Shop phone

- `options` (Object, optional)
  - `isDuplicate` (boolean): Mark as reprint
  - `withBarcode` (boolean): Include barcode
  - `printerName` (string): Specific printer to use

**Returns:** `Promise<boolean>` - True if successful

### printTestReceipt(printerName)

Prints a test receipt to verify printer connection.

**Parameters:**
- `printerName` (string, optional): Specific printer to use

**Returns:** `Promise<boolean>`

## Formatting Receipt Data

### Complete Example

```javascript
const receiptData = {
  receipt_number: '20260419-0042',
  date: new Date().toLocaleString(),
  cashier: 'Sarah',
  items: [
    {
      product_name: 'Maize Meal 10kg',
      quantity: 1,
      selling_price: 45.00,
      subtotal: 45.00
    },
    {
      product_name: 'Sugar 2kg',
      quantity: 2,
      selling_price: 12.50,
      subtotal: 25.00
    },
    {
      product_name: 'Salt 500g',
      quantity: 3,
      selling_price: 2.50,
      subtotal: 7.50
    }
  ],
  subtotal: 77.50,
  tax: 0.00,
  total: 77.50,
  payment_method: 'Cash',
  cash_tendered: 100.00,
  change_given: 22.50
}

const shopInfo = {
  name: 'STOCKA RETAIL',
  address: '45 Leopold Takawira Ave, Harare',
  phone: '+263 4 770 1234'
}
```

## Integration with Sales Page

See [Sales.jsx](../../src/pages/Sales.jsx) for example integration:

```jsx
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'

export const Sales = () => {
  const { printReceipt, isPrinting, printError } = useReceiptPrinter()

  const handleCompleteSale = async (saleData) => {
    // ... validate sale data ...

    // Fetch shop info from database
    const shop = await getShop()

    // Print receipt
    await printReceipt(saleData, shop, {
      isDuplicate: false,
      withBarcode: true
    })
  }
}
```

## Error Handling

The hook automatically handles:
- Printer not found
- Connection timeout
- Permission denied
- Invalid receipt data

Errors are displayed via `printError` state and auto-clear after 5 seconds.

## Printer Detection

The system will:
1. **Auto-detect default printer** if `printerName` is empty
2. **Use specific printer** if `printerName` is provided
3. **Support Bluetooth printers** added via Windows Printer settings

## Troubleshooting

### Printer Not Found
1. Ensure printer is powered on
2. For Bluetooth: Settings → Bluetooth & devices → Printers & scanners
3. Ensure printer appears in Windows Printer list
4. Restart the app

### Print Times Out
1. Check printer connection
2. Verify printer is responsive
3. Try printing from Windows (notepad test)

### Garbled Output
1. Verify printer model supports ESC/POS
2. Check printer encoding settings
3. Restart printer

## Print Width for 58mm Printers

The formatter is configured for **58mm (2-inch) thermal printers** with approximately **22 characters** per line.

To adjust for different widths, modify `posReceiptFormatter.js`:
```javascript
// For 80mm printers (32 characters):
columnWidth: [48, 16]
```

## Advanced Options

### Custom Formatting

Use `formatReceiptForPosPrinter` directly:

```javascript
import { formatReceiptForPosPrinter } from '../utils/posReceiptFormatter'

const formatted = formatReceiptForPosPrinter(receiptData, shopInfo, false)
// ... use formatted directly
```

### With Barcode

```javascript
import { formatReceiptWithBarcode } from '../utils/posReceiptFormatter'

const formatted = formatReceiptWithBarcode(receiptData, shopInfo, false)
// ... includes barcode
```

## Architecture

```
React Component
    ↓
useReceiptPrinter Hook
    ↓
posReceiptFormatter (formats data)
    ↓
window.stocka.printer.printReceipt() (IPC)
    ↓
Electron Main Process
    ↓
PosPrinter.print()
    ↓
System Printer Driver
    ↓
Physical Printer
```

## Related Files

- `src/hooks/useReceiptPrinter.js` - React hook
- `src/utils/posReceiptFormatter.js` - Receipt formatter
- `electron/main.js` - IPC handler ('printer:print-pos')
- `electron/preload.js` - Secure API bridge
