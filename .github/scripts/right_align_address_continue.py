from pathlib import Path

path = Path('src/App.jsx')
text = path.read_text()
old = '<div className="wizard-footer">\n          {step > 0 && <button className="secondary"'
new = '<div className={`wizard-footer ${step === 0 ? \'wizard-footer-single\' : \'\'}`}>\n          {step > 0 && <button className="secondary"'
if old not in text:
    raise SystemExit('wizard footer anchor not found')
text = text.replace(old, new, 1)
path.write_text(text)

css = Path('src/styles.css')
styles = css.read_text()
anchor = '.wizard-footer { padding: 18px 32px 26px; display: flex; justify-content: space-between; border-top: 1px solid #edf0f6; }\n'
addition = anchor + '.wizard-footer.wizard-footer-single { justify-content: flex-end; }\n'
if '.wizard-footer.wizard-footer-single' not in styles:
    if anchor not in styles:
        raise SystemExit('wizard footer CSS anchor not found')
    styles = styles.replace(anchor, addition, 1)
css.write_text(styles)
