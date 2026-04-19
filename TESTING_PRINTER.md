# 🖨️ Quick Start: Thermal Printing Testing

## **Step-by-Step Testing Guide**

### **Phase 1: Hardware Verification** ✅
Before testing the software, ensure hardware is ready:

```
1. Power on your Bluetooth thermal printer
2. Go to Windows Settings → Bluetooth & devices → Printers & scanners
3. Pair the printer if not already paired
4. Verify printer appears in Windows Printers list:
   - Settings → Bluetooth & devices → Printers & scanners
   - Look for your printer name (e.g., "HPRT-IMP001" or similar)
5. Test print from Notepad:
   - Open Notepad
   - Type "TEST PRINT"
   - File → Print → Select your printer → Print
   - ✅ If receipt prints, hardware is working
```

---

### **Phase 2: Code Verification** ✅
All code is already in place:

```
✅ src/hooks/useReceiptPrinter.js        (React hook)
✅ src/utils/posReceiptFormatter.js      (Receipt formatter)  
✅ electron/main.js                      (IPC handler)
✅ electron/preload.js                   (Secure bridge)
✅ src/pages/Sales.jsx                   (Print buttons added)
```

---

### **Phase 3: Test Printing** 🚀

#### **Step 1: Start the App**
```bash
npm run dev
```

#### **Step 2: Navigate to Sales**
- Open the app
- Click "Sales" in the sidebar
- Add items to cart (or create a test sale)

#### **Step 3: Complete a Sale**
- Add any items to cart
- Click "Checkout"
- Select payment method (e.g., "USD Cash")
- Enter cash amount
- Click "Complete Sale"

#### **Step 4: Print Receipt**
After sale completes, you'll see:
```
✅ Sale Completed!
   Total: $XX.XX
   Payment: USD Cash
   Change: $X.XX

   [🖨️ Print Receipt] [🧪 Test Print]
```

**Option A: Print Real Receipt**
- Click **🖨️ Print Receipt**
- You should see:
  - Console: `✅ [POS PRINTER] Receipt printed successfully`
  - Receipt prints to your default printer

**Option B: Test Print First**
- Click **🧪 Test Print**
- A test receipt prints with sample data
- Useful to verify printer works before real sales

---

### **Phase 4: Troubleshooting**

#### **If "Printer not found" error appears:**
```
1. Verify printer appears in Windows Printers list
2. Restart the app
3. Check printer power and connection
4. Try Test Print button first
```

#### **If nothing prints:**
```
1. Check Console (F12) for error messages
2. Verify printer is not in "Offline" state
3. Try printing from Notepad to rule out software issue
4. Check printer's paper and ink/toner
```

#### **If printing is cut off or garbled:**
```
1. This is configured for 58mm (2-inch) printers
2. For different widths, update posReceiptFormatter.js
3. Check printer's ESC/POS support
```

---

### **Phase 5: Production Setup**

Once testing succeeds:

```javascript
// In any React component that needs printing:
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'

const { printReceipt } = useReceiptPrinter()

// Print a sale
const handlePrintSale = async (sale) => {
  const shop = await getShop()
  const success = await printReceipt(sale, shop, {
    isDuplicate: false,
    withBarcode: true
  })
  
  if (success) {
    console.log('Sale printed!')
  }
}
```

---

## **Expected Console Output**

### **Successful Print:**
```
🖨️ [POS PRINTER] Printing receipt...
📍 Printer: Default (auto-detect)
📊 Items: 15 print objects
✅ [POS PRINTER] Receipt printed successfully
```

### **Test Print:**
```
🖨️ [POS PRINTER] Printing receipt...
✅ [POS PRINTER] Receipt printed successfully
```

### **Error:**
```
❌ [POS PRINTER] Print error: Printer not found
```

---

## **Printer Name Reference**

If you want to target a specific printer, find the name:

```powershell
# In PowerShell, run:
Get-Printer | Select-Object Name, PrinterStatus

# Example output:
# Name                          PrinterStatus
# ----                          --------
# Microsoft Print to PDF        Normal
# HPRT-IMP001 (Bluetooth)       Normal
# Canon LBP122                  Normal
```

Then use:
```javascript
await printReceipt(receiptData, shopInfo, {
  printerName: 'HPRT-IMP001 (Bluetooth)'
})
```

---

## **Checklist Before Going Live**

- [ ] Printer powers on and appears in Windows Printers list
- [ ] Test print from Notepad works
- [ ] App starts with `npm run dev`
- [ ] Can complete a sale in the app
- [ ] Test Print button works
- [ ] Real receipt prints correctly
- [ ] Receipt format looks good (no cut-off text)
- [ ] Reprint button works (shows "REPRINT" watermark)
- [ ] Error messages display if printer unavailable

---

## **Support Information**

| Issue | Solution |
|-------|----------|
| Printer not detected | Ensure paired in Windows Bluetooth settings |
| Connection timeout | Check printer power and USB/Bluetooth connection |
| Garbled text | Verify printer model supports ESC/POS |
| Text cut off | Adjust width in posReceiptFormatter.js |
| Multiple copies | Remove duplicated calls to printReceipt() |

---

## **Files to Know**

| File | Purpose |
|------|---------|
| `src/hooks/useReceiptPrinter.js` | React hook for printing |
| `src/utils/posReceiptFormatter.js` | Formats data for PosPrinter |
| `electron/main.js` | IPC handler (`printer:print-pos`) |
| `electron/preload.js` | Secure bridge to Electron |
| `src/pages/Sales.jsx` | Integration point (print buttons) |

---

**Ready to test? Start the app with `npm run dev` and try printing!** 🚀
