// uses `aa-testkit` testing framework for AA tests. Docs can be found here `https://github.com/valyakin/aa-testkit`
// `mocha` standard functions and `expect` from `chai` are available globally
// `Testkit`, `Network`, `Nodes` and `Utils` from `aa-testkit` are available globally too
const path = require('path')
const { expect } = require('chai')
const CONTRACT_BASE_AA = '../option-contract-base.aa'
const HELPER_AA = '../helper.aa'
const objectHash = require('ocore/object_hash.js')


describe('Check AA', function () {
	this.timeout(120000)

	before(async () => {
		this.network = await Network.create()
			.with.agent({ helper: path.join(__dirname, HELPER_AA) })
			.with.agent({ contract_base: path.join(__dirname, CONTRACT_BASE_AA) })
			.with.asset({ reserve_asset: {} })
			.with.asset({ random_asset: {} })
			.with.explorer()
			.with.wallet({ alice: 1e8 })
			.with.wallet({ bob: 1e9 })
			.with.wallet({ oracle: 1e6 })

			.run()

		var { unit, error } = await this.network.deployer.sendMulti({
			asset: this.network.asset.random_asset,
			asset_outputs: [{
				address: await this.network.wallet.alice.getAddress(),
				amount: 50e9
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		var { unit, error } = await this.network.deployer.sendMulti({
			asset: this.network.asset.reserve_asset,
			asset_outputs: [{
				address: await this.network.wallet.alice.getAddress(),
				amount: 30e9
			},{
				address: await this.network.wallet.bob.getAddress(),
				amount: 20e9
			}]
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		console.log('helper: ' + this.network.agent.helper)
		console.log('contract base aa:' + this.network.agent.contract_base)
	})

	it('Deploy AA with greater-equal than comparaison', async () => {
		this.gte_feed_name = 'EUR_USD'
		this.gte_value = 1.2
		this.gte_operator = '>='
		const time_now = new Date()
		this.gte_expiry_date = new Date(time_now.getTime() + 10 * 24 * 3600 * 1000)
		this.last_expiry_date = this.gte_expiry_date;
		const { address, unit, error } = await this.network.deployer.deployAgent(`[
			"autonomous agent",
			{
					"base_aa": "${this.network.agent.contract_base}",
					"params": {
							"oracle_address": "${await this.network.wallet.oracle.getAddress()}",
							"feed_name":"${this.gte_feed_name}",
							"comparison":"${this.gte_operator}",
							"feed_value":"${this.gte_value}",
							"expiry_date": "${this.gte_expiry_date.toISOString().slice(0, -14)}",
							"reserve_asset": "${this.network.asset.reserve_asset}"
					}
			}
		]`)
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		await this.network.witnessUntilStable(unit)

		this.gte_aa = address
	}).timeout(10000)


	it('Alice tries to convert with bytes', async () => {
	
		const { unit, error } = await this.network.wallet.alice.sendBytes({
			toAddress: this.gte_aa,
			amount: 400000
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true

	}).timeout(10000)

	it('Bob converts reserve asset to assets', async () => {
		this.gte_reserve_asset_amount_bob = 1;
		var { unit, error } = await this.network.wallet.bob.sendMulti({
			asset: this.network.asset.reserve_asset,
			asset_outputs: [{
				address: this.gte_aa,
				amount: this.gte_reserve_asset_amount_bob
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gte_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit


		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined

		await this.network.witnessUntilStable(response.response_unit)
		const { vars } = await this.network.deployer.readAAStateVars(this.gte_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit

		this.gte_yes_asset = vars.yes_asset
		this.gte_no_asset = vars.no_asset

		var bob_balances = await this.network.wallet.bob.getBalance()
		expect(bob_balances[this.gte_yes_asset].stable).to.be.equal(this.gte_reserve_asset_amount_bob)
		expect(bob_balances[this.gte_no_asset].stable).to.be.equal(this.gte_reserve_asset_amount_bob)
	}).timeout(600000)

	it('Alice converts reserve asset to assets', async () => {
		this.gte_reserve_asset_amount_alice = 123546;
		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.network.asset.reserve_asset,
			asset_outputs: [{
				address: this.gte_aa,
				amount: this.gte_reserve_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gte_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit


		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined

		await this.network.witnessUntilStable(response.response_unit)
		const { vars } = await this.network.deployer.readAAStateVars(this.gte_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit

		this.gte_yes_asset = vars.yes_asset
		this.gte_no_asset = vars.no_asset

		var alice_balances = await this.network.wallet.alice.getBalance()
		expect(alice_balances[this.gte_yes_asset].stable).to.be.equal(this.gte_reserve_asset_amount_alice)
		expect(alice_balances[this.gte_no_asset].stable).to.be.equal(this.gte_reserve_asset_amount_alice)
	}).timeout(600000)

	it('Bob tries to reedem with no before timeout', async () => {

		var datafeed = {}
		datafeed[this.gte_feed_name] = this.gte_value.toString()

		var objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		var opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)


		var { unit, error } = await this.network.wallet.bob.sendMulti({
			asset: this.gte_no_asset,
			asset_outputs: [{
				address: this.gte_aa,
				amount: this.gte_reserve_asset_amount_bob
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gte_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit


		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
		await this.network.witnessUntilStable(response.response_unit)

	}).timeout(600000)

	it('Bob reedems with no after timeout', async () => {

		var { error } = await this.network.timetravel({ to: this.gte_expiry_date })
		expect(error).to.be.null

		var { unit, error } = await this.network.wallet.bob.sendMulti({
			asset: this.gte_no_asset,
			asset_outputs: [{
				address: this.gte_aa,
				amount: this.gte_reserve_asset_amount_bob
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gte_aa
			}]
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.bob.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			asset: this.network.asset.reserve_asset,
			address: await this.network.wallet.bob.getAddress(),
			amount: this.gte_reserve_asset_amount_bob
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.gte_aa)
		expect(vars.winner).to.be.equal('no')

	}).timeout(600000)



	it('Alice tries redeem with random asset', async () => {

		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.network.asset.random_asset,
			asset_outputs: [{
				address: this.gte_aa,
				amount: this.gte_reserve_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gte_aa
			}]
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('foreign asset')

	}).timeout(600000)

	it('Alice reedems with no after timeout', async () => {

		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.gte_no_asset,
			asset_outputs: [{
				address: this.gte_aa,
				amount: this.gte_reserve_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gte_aa
			}]
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			asset: this.network.asset.reserve_asset,
			address: await this.network.wallet.alice.getAddress(),
			amount: this.gte_reserve_asset_amount_alice
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.gte_aa)
		expect(vars.winner).to.be.equal('no')

	}).timeout(600000)



	it('Deploy AA with less-equal than comparaison', async () => {
		this.lte_feed_name = 'EUR_USD'
		this.lte_value = 1.2
		this.lte_operator = '<='
		const time_now = new Date()
		this.lte_expiry_date = new Date(time_now.getTime() + 10 * 24 * 3600 * 1000)
		this.last_expiry_date = this.lte_expiry_date;
		const { address, unit, error } = await this.network.deployer.deployAgent(`[
			"autonomous agent",
			{
					"base_aa": "${this.network.agent.contract_base}",
					"params": {
							"oracle_address": "${await this.network.wallet.oracle.getAddress()}",
							"feed_name":"${this.lte_feed_name}",
							"comparison":"${this.lte_operator}",
							"feed_value":"${this.lte_value}",
							"expiry_date": "${this.lte_expiry_date.toISOString().slice(0, -14)}",
							"reserve_asset": "${this.network.asset.reserve_asset}"
					}
			}
		]`)
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		await this.network.witnessUntilStable(unit)

		this.lte_aa = address
	}).timeout(10000)


	it('Bob converts reserve asset to assets', async () => {
		this.lte_reserve_asset_amount_bob = 100;
		var { unit, error } = await this.network.wallet.bob.sendMulti({
			asset: this.network.asset.reserve_asset,
			asset_outputs: [{
				address: this.lte_aa,
				amount: this.lte_reserve_asset_amount_bob
			}],
			base_outputs: [{
				amount: 10000,
				address: this.lte_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit


		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined

		await this.network.witnessUntilStable(response.response_unit)
		const { vars } = await this.network.deployer.readAAStateVars(this.lte_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit

		this.lte_yes_asset = vars.yes_asset
		this.lte_no_asset = vars.no_asset

		var bob_balances = await this.network.wallet.bob.getBalance()
		expect(bob_balances[this.lte_yes_asset].stable).to.be.equal(this.lte_reserve_asset_amount_bob)
		expect(bob_balances[this.lte_no_asset].stable).to.be.equal(this.lte_reserve_asset_amount_bob)
	}).timeout(600000)


	it('Bob reedems with yes', async () => {

		var datafeed = {}
		datafeed[this.lte_feed_name] = this.lte_value.toString()

		var objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		var opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)


		var { unit, error } = await this.network.wallet.bob.sendMulti({
			asset: this.lte_yes_asset,
			asset_outputs: [{
				address: this.lte_aa,
				amount: this.lte_reserve_asset_amount_bob
			}],
			base_outputs: [{
				amount: 10000,
				address: this.lte_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit


		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.bob.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			asset: this.network.asset.reserve_asset,
			address: await this.network.wallet.bob.getAddress(),
			amount: this.lte_reserve_asset_amount_bob
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.lte_aa)
		expect(vars.winner).to.be.equal('yes')
	})



	it('Deploy AA with equal comparaison', async () => {
		this.equal_feed_name = 'US-PRESIDENTIAL-2024'
		this.equal_value = 'DUMBO'
		this.equal_operator = '='
		this.equal_expiry_date = new Date(this.last_expiry_date.getTime() + 20 * 24 * 3600 * 1000)
		this.last_expiry_date = this.equal_expiry_date;
		const { address, unit, error } = await this.network.deployer.deployAgent(`[
			"autonomous agent",
			{
					"base_aa": "${this.network.agent.contract_base}",
					"params": {
							"oracle_address": "${await this.network.wallet.oracle.getAddress()}",
							"feed_name":"${this.equal_feed_name}",
							"comparison":"${this.equal_operator}",
							"feed_value":"${this.equal_value}",
							"expiry_date": "${this.equal_expiry_date.toISOString().slice(0, -14)}",
							"reserve_asset": "${this.network.asset.reserve_asset}"
					}
			}
		]`)
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		await this.network.witnessUntilStable(unit)

		this.equal_aa = address
	}).timeout(10000)


	it('Alice converts reserve asset to equal asset', async () => {
		this.equal_asset_amount_alice = 5000
		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.network.asset.reserve_asset,
			asset_outputs: [{
				address: this.equal_aa,
				amount: this.equal_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.equal_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined

		await this.network.witnessUntilStable(response.response_unit)
		const { vars } = await this.network.deployer.readAAStateVars(this.equal_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit

		this.equal_yes_asset = vars.yes_asset
		this.equal_no_asset = vars.no_asset

		var alice_balances = await this.network.wallet.alice.getBalance()
		expect(alice_balances[this.equal_yes_asset].stable).to.be.equal(this.equal_asset_amount_alice)
		expect(alice_balances[this.equal_no_asset].stable).to.be.equal(this.equal_asset_amount_alice)
	}).timeout(600000)

	it('Alice tries to flag equal-aa yes before oracle posts', async () => {
		const { unit, error } = await this.network.wallet.bob.triggerAaWithData({
			toAddress: this.equal_aa,
			amount: 10000,
			data: {
				winner: 'yes'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')

		const { vars } = await this.network.deployer.readAAStateVars(this.equal_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit
		expect(vars.winner).to.be.to.be.undefined
	}).timeout(600000)


	it('Alice tries to flag wrong outcome', async () => {
		const { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.equal_aa,
			amount: 10000,
			data: {
				winner: 'has won'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.equal('wrong suggested outcome')
		expect(response.bounced).to.be.true

	}).timeout(600000)


	it('Alice flags equal-aa yes after oracle posts', async () => {
		const datafeed = {}
		datafeed[this.equal_feed_name] = this.equal_value

		const objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		const opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.equal_aa,
			amount: 10000,
			data: {
				winner: 'yes'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false

		const { vars } = await this.network.deployer.readAAStateVars(this.equal_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit
		expect(vars.winner).to.be.to.be.equal('yes')
	}).timeout(600000)

	it('Alice tries to redeem equal-aa with no asset', async () => {
		var { error } = await this.network.timetravel({ to: this.equal_expiry_date })
		var { error } = await this.network.timetravel({ shift: '1d' })

		expect(error).to.be.null
		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.equal_no_asset,
			asset_outputs: [{
				address: this.equal_aa,
				amount: this.equal_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.equal_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
	}).timeout(600000)

	it('Alice tries to flag equal-aa with no after oracle contradicted', async () => {
		const datafeed = {}
		datafeed[this.equal_feed_name] = 'random value'

		const objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		const opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.equal_aa,
			amount: 10000,
			data: {
				winner: 'no'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
		expect(response.bounced).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.equal_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit
		expect(vars.winner).to.be.to.be.equal('yes')
	}).timeout(600000)

	it('Alice redeems with yes', async () => {
		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.equal_yes_asset,
			asset_outputs: [{
				address: this.equal_aa,
				amount: this.equal_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.equal_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			asset: this.network.asset.reserve_asset,
			address: await this.network.wallet.alice.getAddress(),
			amount: this.equal_asset_amount_alice
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.equal_aa)
		expect(vars.winner).to.be.equal('yes')
	}).timeout(600000)


	it('Deploy AA with greater-than comparaison', async () => {
		this.gt_feed_name = 'EUR_USD'
		this.gt_value = 1.2
		this.gt_operator = '>'
		this.gt_days_for_expiration = 10
		this.gt_expiry_date = new Date(this.last_expiry_date.getTime() + 10 * 24 * 3600 * 1000)
		const { address, unit, error } = await this.network.deployer.deployAgent(`[
			"autonomous agent",
			{
					"base_aa": "${this.network.agent.contract_base}",
					"params": {
							"oracle_address": "${await this.network.wallet.oracle.getAddress()}",
							"feed_name":"${this.gt_feed_name}",
							"comparison":"${this.gt_operator}",
							"feed_value":"${this.gt_value}",
							"expiry_date": "${this.gt_expiry_date.toISOString().slice(0, -14)}",
							"reserve_asset": "${this.network.asset.reserve_asset}"
					}
			}
		]`)
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		await this.network.witnessUntilStable(unit)

		this.gt_aa = address
	}).timeout(10000)


	it('Alice converts reserve asset to greater asset', async () => {
		this.gt_asset_amount_alice = 66666666
		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.network.asset.reserve_asset,
			asset_outputs: [{
				address: this.gt_aa,
				amount: this.gt_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gt_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined

		await this.network.witnessUntilStable(response.response_unit)
		const { vars } = await this.network.deployer.readAAStateVars(this.gt_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit

		this.gt_yes_asset = vars.yes_asset
		this.gt_no_asset = vars.no_asset

		var alice_balances = await this.network.wallet.alice.getBalance()
		expect(alice_balances[this.gt_yes_asset].stable).to.be.equal(this.gt_asset_amount_alice)
		expect(alice_balances[this.gt_no_asset].stable).to.be.equal(this.gt_asset_amount_alice)
	}).timeout(600000)

	it('Alice tries to flag greater-aa with no before timeout', async () => {

		var { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.gt_aa,
			amount: 10000,
			data: {
				winner: 'no'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
		expect(response.bounced).to.be.true
	}).timeout(600000)


	it('Alice flags greater-aa with no after timeout', async () => {
		var { error } = await this.network.timetravel({ to: this.gt_expiry_date })
		//var { error } = await this.network.timetravel({ shift: '1d' })

		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.gt_aa,
			amount: 10000,
			data: {
				winner: 'no'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false

		const { vars } = await this.network.deployer.readAAStateVars(this.gt_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit
		expect(vars.winner).to.be.to.be.equal('no')
	}).timeout(600000)

	it('Alice reedems greater-aa with no', async () => {

		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.gt_no_asset,
			asset_outputs: [{
				address: this.gt_aa,
				amount: this.gt_asset_amount_alice / 2
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gt_aa
			}]
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			asset: this.network.asset.reserve_asset,
			address: await this.network.wallet.alice.getAddress(),
			amount: this.gt_asset_amount_alice / 2
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.gt_aa)
		expect(vars.winner).to.be.equal('no')

	}).timeout(600000)


	after(async () => {
		// uncomment this line to pause test execution to get time for Obyte DAG explorer inspection
		//await Utils.sleep(3600 * 1000)
		await this.network.stop()
	})
})
