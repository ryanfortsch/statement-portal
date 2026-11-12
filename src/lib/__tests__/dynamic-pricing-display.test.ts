import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pricingMoney,pricingPercent,pricingDateRange,pricingPeriodDates} from '../dynamic-pricing-display.ts';
import {pricingOccupancyWindow,sortPricingPortfolioRows,pricingPortfolioRow} from '../dynamic-pricing-portfolio.ts';

test('display rounding retains exact cents on inspection, zero, missing values and raw sort order',()=>{
  assert.equal(pricingMoney(25837),'$258');
  assert.equal(pricingMoney(25850),'$259');
  assert.equal(pricingMoney(25837,true),'$258.37');
  assert.equal(pricingMoney(89820,true),'$898.20');
  assert.equal(pricingMoney(120000),'$1,200');
  assert.equal(pricingMoney(0),'$0');
  for(const value of [null,undefined,NaN,Infinity])assert.equal(pricingMoney(value),'–');
  assert.equal(pricingPercent(100/3),'33%');
  assert.equal(pricingPercent(0),'0%');
  assert.equal(pricingPercent(null),'–');
  const now=new Date('2026-11-11T12:00:00Z');
  const rows=[['A',25840],['Z',25837]].map(([name,value])=>({...pricingPortfolioRow({id:String(name),name:String(name),city:'',bedrooms:null,authority:'helm'},null,'2026-11-11',now),currentRateCents:{7:Number(value),30:Number(value),60:Number(value),90:Number(value)}}));
  const before=structuredClone(rows);
  assert.equal(pricingMoney(rows[0].currentRateCents[30]),pricingMoney(rows[1].currentRateCents[30]));
  assert.deepEqual(sortPricingPortfolioRows(rows,{sort:'rate',direction:'asc',window:30}).map(r=>r.name),['Z','A']);
  assert.deepEqual(rows,before);
});

test('period labels use the same inclusive dates as occupancy across months, years and leap days',()=>{
  const now=new Date('2026-11-11T12:00:00Z');
  const window=pricingOccupancyWindow(null,'2026-11-11',30,now);
  assert.equal(pricingDateRange(window.start,window.end),'Nov 11 – Dec 10, 2026');
  const year=pricingOccupancyWindow(null,'2026-12-28',7,now);
  assert.equal(pricingDateRange(year.start,year.end),'Dec 28, 2026 – Jan 3, 2027');
  const leap=pricingOccupancyWindow(null,'2028-02-25',7,now);
  assert.equal(pricingDateRange(leap.start,leap.end),'Feb 25 – Mar 2, 2028');
  assert.equal(pricingDateRange('2026-11-11','2026-11-11'),'Nov 11, 2026');
  assert.equal(pricingPeriodDates([window,{...window}]),'Nov 11 – Dec 10, 2026');
  assert.equal(pricingPeriodDates([window,{...window,start:'2026-11-12'}]),'Local dates vary by property');
  assert.equal(pricingPeriodDates([]),'Dates unavailable');
});
