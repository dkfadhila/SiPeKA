'use strict';
const words=['','satu','dua','tiga','empat','lima','enam','tujuh','delapan','sembilan','sepuluh','sebelas'];
function spell(n){if(n<12n)return words[Number(n)];if(n<20n)return spell(n-10n)+' belas';if(n<100n)return spell(n/10n)+' puluh '+spell(n%10n);if(n<200n)return 'seratus '+spell(n-100n);if(n<1000n)return spell(n/100n)+' ratus '+spell(n%100n);if(n<2000n)return 'seribu '+spell(n-1000n);for(const [limit,label] of [[10n**18n,'kuintiliun'],[10n**15n,'kuadriliun'],[10n**12n,'triliun'],[10n**9n,'miliar'],[1000000n,'juta'],[1000n,'ribu']])if(n>=limit)return spell(n/limit)+' '+label+' '+spell(n%limit);}
function rupiahWords(value){if(!/^(0|[1-9]\d{0,30})$/.test(String(value)))throw Error('PAYROLL_INTEGER_IDR');const n=BigInt(value);return ((n===0n?'nol':spell(n)).replace(/\s+/g,' ').trim()+' rupiah').replace(/^./,c=>c.toUpperCase());}
module.exports={rupiahWords};
